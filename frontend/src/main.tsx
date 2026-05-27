import '@/lib/env';
import ReactDOM from 'react-dom/client';
import { initAppParams } from '@/lib/app-params';
import App from '@/App';
import '@/index.css';

initAppParams();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
