import { useEffect, useRef, useState } from 'react';
import type { RgbaImage } from '@lib/core/types';
import type { Grid } from '@lib/core/types';
import { generatePatternBead, renderPatternImage, MARD291 } from '@lib/index';
import { decodeImage } from './lib/decode';
import { preprocess } from './lib/pipeline';

/** 预览用小分辨率（正式导出时另用 40） */
const PREVIEW_CELL = 20;

export default function App() {
  const [img, setImg] = useState<RgbaImage | null>(null);
  const [origUrl, setOrigUrl] = useState('');
  const [name, setName] = useState('');
  const [maxSide, setMaxSide] = useState(64);
  const [blurOn, setBlurOn] = useState(true);
  const [sigma, setSigma] = useState(1);
  const [kColors, setKColors] = useState(64);
  const [crop, setCrop] = useState(true);
  const [info, setInfo] = useState('');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [busy, setBusy] = useState(false);

  const prevRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);

  /** 核心：预处理 + 生成 grid */
  function buildGrid(src: RgbaImage): Grid {
    const work = preprocess(src, { blurOn, sigma, kColors });
    return generatePatternBead(work, { palette: MARD291, maxSide, cropToSubject: crop });
  }

  /** 轻量预览绘制（小 cell） */
  function drawPreview(g: Grid) {
    const formal = renderPatternImage(g, { cell: PREVIEW_CELL, board: 29 });
    const cv = prevRef.current!;
    cv.width = formal.width;
    cv.height = formal.height;
    const ctx = cv.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(formal.data), formal.width, formal.height), 0, 0);
  }

  // 参数/图片变化 → 防抖 250ms 后重算（避免滑块拖动逐帧全量计算）
  useEffect(() => {
    if (!img) return;
    setBusy(true);
    const t = setTimeout(() => {
      const g = buildGrid(img);
      setGrid(g);
      drawPreview(g);
      setInfo(`${g.cols}×${g.rows} 格 · ${g.colorCount} 色 · 源 ${img.width}×${img.height}`);
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, maxSide, blurOn, sigma, kColors, crop]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const bmp = await decodeImage(f);
    setImg(bmp);
    setName(f.name);
    setOrigUrl(URL.createObjectURL(f));
  }

  /** 导出：即时生成全尺寸正式图纸再下载 */
  function download() {
    if (!grid) return;
    setDownloading(true);
    // 让 UI 先响应，再大图生成
    setTimeout(() => {
      const formal = renderPatternImage(grid, { cell: 40, board: 29 });
      const cv = document.createElement('canvas');
      cv.width = formal.width;
      cv.height = formal.height;
      cv.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(formal.data), formal.width, formal.height),
        0,
        0,
      );
      const a = document.createElement('a');
      a.download = (name.replace(/\.[^.]+$/, '') || 'pattern') + '_pattern.png';
      a.href = cv.toDataURL('image/png');
      a.click();
      setDownloading(false);
    }, 0);
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 300, padding: 16, borderRight: '1px solid #333', overflowY: 'auto' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 16px' }}>拼豆图纸 · MirrorPin</h1>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <input type="file" accept="image/*" onChange={onFile} />
        </label>
        {origUrl && (
          <img src={origUrl} alt="原图" style={{ width: '100%', height: 160, objectFit: 'contain', background: '#000', borderRadius: 6, marginBottom: 8 }} />
        )}

        <div style={{ margin: '8px 0' }}>
          <label>网格最大边长</label>
          <input type="range" min={16} max={120} value={maxSide} onChange={(e) => setMaxSide(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ fontSize: 12, color: '#aaa' }}>{maxSide}</div>
        </div>

        <label style={{ display: 'block', margin: '6px 0' }}>
          <input type="checkbox" checked={blurOn} onChange={(e) => setBlurOn(e.target.checked)} /> 高斯模糊
        </label>
        <div style={{ margin: '8px 0' }}>
          <label>模糊强度 σ</label>
          <input type="range" min={0} max={6} step={0.5} value={sigma} onChange={(e) => setSigma(Number(e.target.value))} style={{ width: '100%' }} disabled={!blurOn} />
          <div style={{ fontSize: 12, color: '#aaa' }}>{sigma}</div>
        </div>
        <div style={{ margin: '8px 0' }}>
          <label>降色数</label>
          <input type="range" min={16} max={96} step={4} value={kColors} onChange={(e) => setKColors(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ fontSize: 12, color: '#aaa' }}>{kColors}</div>
        </div>
        <label style={{ display: 'block', margin: '6px 0' }}>
          <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} /> 透明通道裁剪
        </label>

        <div style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>{info}</div>
        {busy && <div style={{ fontSize: 12, color: '#888' }}>…</div>}
        <button onClick={download} disabled={!grid || downloading} style={{ marginTop: 12, padding: '8px 16px' }}>
          {downloading ? '导出中…' : '导出图纸 PNG'}
        </button>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', overflow: 'auto', maxWidth: '100%' }}>
          <canvas ref={prevRef} style={{ boxShadow: '0 2px 12px rgba(0,0,0,.4)', background: '#fff', maxWidth: '100%', height: 'auto' }} />
        </div>
      </main>
    </div>
  );
}