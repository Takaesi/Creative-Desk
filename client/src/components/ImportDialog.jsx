import { Modal } from './ui.jsx';

export default function ImportDialog({ onClose }) {
  return <Modal open onClose={onClose} title="Импорт результатов"><p className="muted">Будет доступно в следующей фазе.</p></Modal>;
}
