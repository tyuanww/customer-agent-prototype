import { type ChangeEvent, useRef, useState } from 'react';

const WRITE_UNAVAILABLE = '未接入：SOP 持久化需要 contracts:intake，当前没有写库命令。';

export function SopLibraryModule() {
  const [writeMessage, setWriteMessage] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const refuseWrite = () => setWriteMessage(WRITE_UNAVAILABLE);

  return (
    <div className="dash-module" data-testid="module-sop">
      <header className="dash-module-head">
        <div>
          <h1>SOP</h1>
          <p className="dash-kicker">写库未接入 · 不展示合成树当正式目录</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        上传、更新、删除、导出、自定义步骤都需要 SOP 持久化合同。没有写库接口时按钮不会假装成功，也不用合成过敏树冒充已入库目录。
      </p>
      <div className="dash-filter-toolbar" aria-label="SOP 写操作">
        <input
          ref={uploadRef}
          data-testid="sop-upload-input"
          type="file"
          accept=".csv,.xlsx"
          hidden
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            event.target.value = '';
            refuseWrite();
          }}
        />
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-upload"
          onClick={() => uploadRef.current?.click()}
        >
          上传
        </button>
        <button type="button" className="dash-reset" data-testid="sop-update" onClick={refuseWrite}>更新</button>
        <button type="button" className="dash-reset" data-testid="sop-delete" onClick={refuseWrite}>删除</button>
        <button type="button" className="dash-reset" data-testid="sop-export" onClick={refuseWrite}>导出</button>
        <button type="button" className="dash-reset" data-testid="sop-custom-step" onClick={refuseWrite}>自定义步骤</button>
      </div>
      {writeMessage ? <p className="dash-scope" data-testid="sop-write-status">{writeMessage}</p> : null}
      <div className="dash-empty-state" data-testid="sop-library-empty">
        <strong>未接入 SOP 库</strong>
        <span>坐席过敏窗仍可用预览树；工作台不把合成树当作可运营目录。</span>
      </div>
    </div>
  );
}
