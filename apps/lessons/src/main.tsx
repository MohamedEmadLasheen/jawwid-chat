import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { QuranFontGate } from './quran/font';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* No verse before Amiri Quran has loaded, and none in a fallback font (quran/font.tsx). */}
    <QuranFontGate>
      <App />
    </QuranFontGate>
  </StrictMode>,
);
