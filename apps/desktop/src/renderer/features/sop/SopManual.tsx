import { Button, Collapse, Empty, Flex, Input, Select, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { SopTree } from '@shared/sop-model';
import { isSopManualImageProjections, type SopManualImageProjection } from '@shared/sop-window';
import { SopImages } from './SopImages';
import '../../styles/query-sop.css';

type ManualImagesState =
  | { kind: 'loading' | 'retrying' | 'retryable-error' | 'unavailable' }
  | { kind: 'ready'; projections: readonly SopManualImageProjection[] };

/** Reads the same task definitions as execution without creating or changing a session. */
export function SopManual({ trees }: { trees: readonly SopTree[] }) {
  const [sceneId, setSceneId] = useState(trees[0]?.sceneId ?? '');
  const [nodeId, setNodeId] = useState('');
  const [query, setQuery] = useState('');
  const [imageState, setImageState] = useState<ManualImagesState>({ kind: 'loading' });
  const readingImages = imageState.kind === 'loading' || imageState.kind === 'retrying';
  useEffect(() => {
    if (!readingImages) return;
    let alive = true;
    const read = window.dashboardWorkbench?.sopImages;
    if (!read) { setImageState({ kind: 'unavailable' }); return () => { alive = false; }; }
    void Promise.resolve().then(() => read()).then(value => {
      if (alive) setImageState(isSopManualImageProjections(value) ? { kind: 'ready', projections: value } : { kind: 'unavailable' });
    }).catch(() => { if (alive) setImageState({ kind: 'retryable-error' }); });
    return () => { alive = false; };
  }, [readingImages]);
  const tree = trees.find(item => item.sceneId === sceneId) ?? trees[0];
  if (!tree) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发布 SOP 后可在这里查阅" />;
  const node = tree.nodes.find(item => item.id === nodeId) ?? tree.nodes.find(item => item.id === tree.startNodeId);
  const candidate = imageState.kind === 'ready' ? imageState.projections.find(item => item.sceneId === tree.sceneId && item.nodeId === node?.id) : undefined;
  const projectedImages = node && candidate && candidate.scripts.length === node.scripts.length && candidate.knowledge.length === node.knowledge.length
    && node.scripts.every(script => candidate.scripts.some(item => item.scriptId === script.id))
    && node.knowledge.every(knowledge => candidate.knowledge.some(item => item.id === knowledge.id)) ? candidate : undefined;
  const term = query.trim().toLocaleLowerCase();
  const matches = tree.nodes.filter(item => !term || [item.title, item.instruction, ...item.knowledge.flatMap(knowledge => [knowledge.title, knowledge.body])]
    .some(text => text.toLocaleLowerCase().includes(term)));
  return <section className="sop-manual" aria-label="SOP 手册">
    <Flex gap={12} align="center" wrap className="sop-manual-toolbar">
      <Typography.Title level={4}>SOP 手册</Typography.Title>
      <Select aria-label="选择流程" value={tree.sceneId} options={trees.map(item => ({ value: item.sceneId, label: item.sceneTitle }))}
        onChange={value => { setSceneId(value); setNodeId(''); setQuery(''); }} />
      <Input className="sop-manual-search" aria-label="查找步骤和知识" placeholder="查找步骤和知识" value={query} allowClear onChange={event => setQuery(event.target.value)} />
    </Flex>
    <div className="sop-manual-layout">
      <nav aria-label="手册任务目录" className="sop-manual-nav">
        {matches.map(item => <Button type={item.id === node?.id ? 'primary' : 'text'} key={item.id} aria-current={item.id === node?.id ? 'page' : undefined}
          onClick={() => setNodeId(item.id)}>{item.title}</Button>)}
        {matches.length === 0 ? <Typography.Text type="secondary">没有找到相关步骤</Typography.Text> : null}
      </nav>
      {node ? <article className="sop-manual-article" aria-label={node.title}>
        <Typography.Text type="secondary">{node.stageLabel}</Typography.Text>
        <Typography.Title level={4}>{node.title}</Typography.Title>
        <Typography.Paragraph>{node.instruction}</Typography.Paragraph>
        {imageState.kind === 'loading' ? <Typography.Text type="secondary" role="status">正在读取图片…</Typography.Text> : null}
        {imageState.kind === 'retryable-error' || imageState.kind === 'retrying' ? <Flex gap={8} align="center" wrap>
          <Typography.Text type="secondary" role="status">{imageState.kind === 'retrying' ? '正在重新读取图片…' : '图片读取失败'}</Typography.Text>
          <Button loading={imageState.kind === 'retrying'} disabled={imageState.kind === 'retrying'}
            onClick={() => setImageState(current => current.kind === 'retryable-error' ? { kind: 'retrying' } : current)}>重新读取图片</Button>
        </Flex> : null}
        {imageState.kind === 'unavailable' || (imageState.kind === 'ready' && !projectedImages)
          ? <Typography.Text type="secondary" role="status">图片暂时无法显示</Typography.Text> : null}
        <SopImages images={projectedImages?.images ?? []} />
        {node.requirements.length ? <section aria-label="需要核实"><Typography.Text strong>需要核实</Typography.Text>
          <ul>{node.requirements.map(item => <li key={item.id}>{item.label}</li>)}</ul></section> : null}
        {node.kind === 'decision' ? <section aria-label="判断与去向"><Typography.Text strong>判断与去向</Typography.Text>
          <ul className="sop-manual-branches">{node.edges.map(edge => <li key={edge.id}><Typography.Text strong>{edge.label}</Typography.Text>
            <Typography.Paragraph>{edge.criterion}</Typography.Paragraph>
            <Button type="link" onClick={() => setNodeId(edge.targetId)}>{tree.nodes.find(item => item.id === edge.targetId)?.title ?? '查看后续任务'}</Button></li>)}</ul></section> : null}
        {node.scripts.length ? <Collapse key={`${tree.sceneId}-${node.id}-scripts`} ghost items={node.scripts.map(script => ({ key: script.id,
          label: script.title, children: <><Typography.Paragraph type="secondary">{script.condition}</Typography.Paragraph><Typography.Paragraph>{script.answerText}</Typography.Paragraph>
            <SopImages images={projectedImages?.scripts.find(item => item.scriptId === script.id)?.images ?? []} /></> }))} /> : null}
        {node.knowledge.map(item => <section key={item.id}><Typography.Text strong>{item.title}</Typography.Text><Typography.Paragraph>{item.body}</Typography.Paragraph>
          <SopImages images={projectedImages?.knowledge.find(knowledge => knowledge.id === item.id)?.images ?? []} /></section>)}
        {node.kind === 'action' ? <Button onClick={() => setNodeId(node.nextId)}>查看后续任务</Button> : null}
        {node.kind === 'terminal' ? <Typography.Text type="secondary">流程终点</Typography.Text> : null}
      </article> : null}
    </div>
  </section>;
}
