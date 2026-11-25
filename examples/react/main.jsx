import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { YsmViewer } from '@lemwood/ysm-threejs-engine/react';

function Example() {
  const viewer = useRef(null);
  const [file, setFile] = useState(null);
  const [animations, setAnimations] = useState([]);
  const [animation, setAnimation] = useState('idle');
  const [paused, setPaused] = useState(false);
  return (
    <main style={{ maxWidth: 900, margin: '24px auto', fontFamily: 'system-ui' }}>
      <h1>YSM Viewer</h1>
      <input type="file" accept=".ysm,.zip" onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <YsmViewer
        ref={viewer} source={file} animation={animation} paused={paused}
        style={{ height: 520, marginBlock: 16 }} loadingFallback="正在加载…"
        onLoad={model => { setAnimations(model.animations); setAnimation(model.animations.includes('idle') ? 'idle' : model.animations[0] ?? null); }}
        onWarnings={warnings => { if (warnings.length) console.warn('动画表达式诊断', warnings); }}
      />
      <select value={animation ?? ''} onChange={event => setAnimation(event.target.value || null)}>
        <option value="">停止主动画</option>
        {animations.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <button onClick={() => setPaused(value => !value)}>{paused ? '继续' : '暂停'}</button>
      <button onClick={() => { setFile(null); setAnimations([]); }}>移除模型</button>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Example /></React.StrictMode>);
