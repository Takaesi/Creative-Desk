import { useState } from 'react';
import { Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { fmtDayFull, fmtNum } from '../utils.js';
import { Modal, useToast } from './ui.jsx';

/** Импорт результатов из CSV: выбор файла → предпросмотр (dry_run) → импорт валидных строк. */
export default function ImportDialog({ onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (dry, f = file) => {
    const fd = new FormData();
    fd.append('file', f);
    return api.post(`/metrics/import?dry_run=${dry ? 1 : 0}`, fd);
  };
  const pick = async (f) => {
    if (!f) return;
    setFile(f); setPreview(null); setBusy(true);
    try { setPreview(await send(true, f)); } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await send(false);
      toast(`Импортировано: добавлено ${r.added}, обновлено ${r.updated}${r.skipped ? `, пропущено ${r.skipped}` : ''}`);
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const valid = preview ? preview.added + preview.updated : 0;

  return (
    <Modal open onClose={onClose} title="Импорт результатов из CSV" width={720}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={run}><Upload size={15} /> Импортировать {valid ? `(${valid})` : ''}</button>
      </>}>
      <div className="stack">
        <div className="import-hint">
          <p>Выгрузите отчёт из трекера или рекламного кабинета. Колонки: <code>creative</code> (или <code>креатив</code>, <code>код</code>, <code>объявление</code>, <code>название</code>, <code>ad name</code>, <code>sub_id</code>), <code>date</code>, <code>impressions</code>, <code>clicks</code>, <code>conversions</code>, <code>spend</code>, <code>revenue</code> — допускаются русские названия.</p>
          <p className="muted small">Код креатива ищется прямо в названии объявления: <code>BR_nutra_CD-142_v2</code> → CD-142. Разделитель «,» или «;», даты <code>2026-01-15</code> или <code>15.01.2026</code>, дробные — через запятую или точку. Строки одного креатива за один день суммируются, повторный импорт обновляет данные.</p>
          <a className="link-btn" href="/api/metrics/template.csv"><Download size={13} /> Скачать шаблон CSV</a>
        </div>
        <label className="dropzone">
          <Upload size={18} />
          <span>{file ? file.name : 'Выберите CSV-файл (до 2 МБ)'}</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files[0])} />
        </label>
        {busy && !preview && <div className="splash small"><div className="spinner" /></div>}
        {preview && (
          <>
            <div className="import-stats">
              <span className="pos"><CheckCircle2 size={15} /> будет добавлено <b>{preview.added}</b></span>
              <span>обновлено <b>{preview.updated}</b></span>
              <span className={preview.errors.length ? 'neg' : 'muted'}><AlertTriangle size={15} /> ошибок <b>{preview.skipped}</b></span>
            </div>
            {preview.errors.length > 0 && (
              <ul className="import-errors">
                {preview.errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            )}
            {preview.preview.length > 0 && (
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead><tr><th>Креатив</th><th>Дата</th><th className="num">Показы</th><th className="num">Клики</th><th className="num">Конв.</th><th className="num">Расход</th><th className="num">Доход</th><th /></tr></thead>
                  <tbody>
                    {preview.preview.map((r) => (
                      <tr key={`${r.code}-${r.date}`}>
                        <td><b>{r.code}</b></td><td>{fmtDayFull(r.date)}</td>
                        <td className="num">{fmtNum(r.impressions)}</td><td className="num">{fmtNum(r.clicks)}</td><td className="num">{fmtNum(r.conversions)}</td>
                        <td className="num">{fmtNum(r.spend, 2)}</td><td className="num">{fmtNum(r.revenue, 2)}</td>
                        <td className="muted small">{r.existed ? 'обновится' : 'новая'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!valid && <p className="muted small">Нет строк, которые можно импортировать.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
