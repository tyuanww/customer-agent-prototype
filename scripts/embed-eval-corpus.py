"""Embed the E1 synthetic eval set with a local model.

Does not call MiniMax and does not write the production retrieval index.
Default model is Qwen/Qwen3-Embedding-0.6B. The rerank stage uses
Qwen/Qwen3-Reranker-0.6B on the dense top 8 for each query.

Run from the repo root:

  uv run --python 3.12 --with sentence-transformers --with torch scripts/embed-eval-corpus.py

The vector file is written outside the repo. Point the desktop scorer at it
with CUSTOMER_AGENT_DENSE_EVAL=1 and CUSTOMER_AGENT_DENSE_EVAL_FILE.
"""

from __future__ import annotations

import argparse
import json
import platform
import resource
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "apps/desktop/tests/fixtures/retrieval-eval/corpus.json"
CASES = ROOT / "apps/desktop/tests/fixtures/retrieval-eval/cases.json"
DEFAULT_OUT = Path("/tmp/ca-dense-eval.json")
EMBED_MODEL = "Qwen/Qwen3-Embedding-0.6B"
RERANK_MODEL = "Qwen/Qwen3-Reranker-0.6B"
TOP_PASSAGES = 8


def refuse(model: str) -> None:
    lowered = model.lower()
    if "minimax" in lowered or "embo" in lowered:
        sys.exit(f"refusing paid embedding model: {model}")


def peak_bytes() -> int:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return int(usage)
    return int(usage) * 1024


def query_rows() -> list[dict[str, str]]:
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    rows: list[dict[str, str]] = []
    for script_id, queries in cases["positives"].items():
        for offset, query in enumerate(queries, start=1):
            rows.append({"id": f"{script_id}#{offset}", "text": query})
    for offset, query in enumerate(cases["negatives"], start=1):
        rows.append({"id": f"negative#{offset}", "text": query})
    return rows


def cosine_top(query_vector: list[float], scripts: list[dict[str, object]], limit: int) -> list[str]:
    scored: list[tuple[float, str]] = []
    for script in scripts:
        vector = script["vector"]
        if not isinstance(vector, list):
            continue
        score = sum(left * right for left, right in zip(query_vector, vector, strict=True))
        script_id = script["scriptId"]
        if isinstance(script_id, str) and score > 0:
            scored.append((score, script_id))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [script_id for _score, script_id in scored[:limit]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--embed-model", default=EMBED_MODEL)
    parser.add_argument("--rerank-model", default=RERANK_MODEL)
    parser.add_argument("--skip-rerank", action="store_true")
    args = parser.parse_args()
    refuse(args.embed_model)
    refuse(args.rerank_model)

    import torch
    from sentence_transformers import CrossEncoder, SentenceTransformer

    device = "cpu"
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"

    print(f"device={device}", flush=True)
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    scripts_in = corpus["scripts"]
    queries_in = query_rows()
    answers = [script["answerText"] for script in scripts_in]
    embedder = SentenceTransformer(args.embed_model, device=device)

    script_rows: list[dict[str, object]] = []
    embed_started = time.perf_counter()
    answer_vectors = embedder.encode(answers, prompt="", normalize_embeddings=True, show_progress_bar=True)
    answer_ms = (time.perf_counter() - embed_started) * 1000 / max(len(answers), 1)
    for script, vector in zip(scripts_in, answer_vectors, strict=True):
        script_rows.append({
            "scriptId": script["scriptId"],
            "vector": [float(cell) for cell in vector],
            "embedMs": round(answer_ms, 3),
        })

    query_started = time.perf_counter()
    query_vectors = embedder.encode(
        [row["text"] for row in queries_in],
        prompt_name="query",
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    query_ms = (time.perf_counter() - query_started) * 1000 / max(len(queries_in), 1)
    query_rows_out: list[dict[str, object]] = []
    for row, vector in zip(queries_in, query_vectors, strict=True):
        query_rows_out.append({
            "id": row["id"],
            "vector": [float(cell) for cell in vector],
            "embedMs": round(query_ms, 3),
        })

    dim = len(script_rows[0]["vector"]) if script_rows else 0
    partial = {
        "model": args.embed_model,
        "rerankModel": None,
        "rerankError": None,
        "device": device,
        "dim": dim,
        "host": platform.platform(),
        "peakBytes": peak_bytes(),
        "acceleratorPeakBytes": None,
        "scripts": script_rows,
        "queries": query_rows_out,
        "rerank": [],
    }
    args.out.write_text(json.dumps(partial), encoding="utf-8")
    print(f"vectors {args.out} device={device} dim={dim}", flush=True)
    rerank_rows: list[dict[str, object]] = []
    rerank_error = None
    rerank_model = None
    if not args.skip_rerank:
        try:
            reranker = CrossEncoder(args.rerank_model, device=device)
            rerank_model = args.rerank_model
            by_id = {script["scriptId"]: script["answerText"] for script in scripts_in}
            for row, vector in zip(queries_in, query_rows_out, strict=True):
                raw_vector = vector["vector"]
                if not isinstance(raw_vector, list):
                    continue
                chosen = cosine_top(raw_vector, script_rows, TOP_PASSAGES)
                pairs = [(row["text"], by_id[script_id]) for script_id in chosen if script_id in by_id]
                started = time.perf_counter()
                scores = reranker.predict(pairs, show_progress_bar=False) if pairs else []
                elapsed = (time.perf_counter() - started) * 1000
                ordered = [script_id for script_id, _score in sorted(
                    zip(chosen, scores, strict=True),
                    key=lambda item: (-float(item[1]), item[0]),
                )]
                rerank_rows.append({"id": row["id"], "orderedIds": ordered, "ms": round(elapsed, 3)})
        except Exception as error:  # The report records the failure and still keeps the vectors.
            rerank_error = f"{type(error).__name__}: {error}"

    mps_peak = None
    if device == "mps":
        mps_peak = int(torch.mps.current_allocated_memory())
    cuda_peak = None
    if device == "cuda":
        cuda_peak = int(torch.cuda.max_memory_allocated())

    payload = {
        "model": args.embed_model,
        "rerankModel": rerank_model,
        "rerankError": rerank_error,
        "device": device,
        "dim": dim,
        "host": platform.platform(),
        "peakBytes": peak_bytes(),
        "acceleratorPeakBytes": mps_peak if mps_peak is not None else cuda_peak,
        "scripts": script_rows,
        "queries": query_rows_out,
        "rerank": rerank_rows,
    }
    args.out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"wrote {args.out} device={device} dim={dim} scripts={len(script_rows)} queries={len(query_rows_out)} rerank={len(rerank_rows)} error={rerank_error}")


if __name__ == "__main__":
    main()
