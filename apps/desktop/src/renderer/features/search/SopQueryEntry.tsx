import { useEffect, useState } from 'react';

/** Visible only when Main installed the explicit synthetic SOP consumer. */
export function SopQueryEntry() {
  const [enabled,setEnabled]=useState(false), [error,setError]=useState('');
  useEffect(()=> {let live=true; void window.customerAgent?.sopWindow?.entryAvailable().then(value=> {if(live)setEnabled(value);}).catch(()=>{if(live)setEnabled(false);});return()=>{live=false;};},[]);
  if (!enabled) return null;
  return <div className="sop-entry-banner">
    <button type="button" className="retry-btn" onClick={()=> {
      void window.customerAgent?.sopWindow?.open('sop-query').then(result=>setError(result.ok?'':result.message)).catch(()=>setError('流程没有打开，请重试。'));
    }}>打开 SOP 流程</button>
    {error ? <span role="status">{error}</span> : null}
  </div>;
}
