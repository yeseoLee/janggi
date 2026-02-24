import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const path = location.pathname;
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2200);
  };

  const isActive = (target) => path === target;

  return (
    <>
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          <button
            className={`bottom-nav-item ${isActive('/') ? 'active' : ''}`}
            onClick={() => navigate('/')}
          >
            <span className="material-icons-round">home</span>
            <span>{t('nav.home')}</span>
          </button>

          <button
            className="bottom-nav-item"
            onClick={() => showToast(t('nav.puzzleComingSoon'))}
          >
            <span className="material-icons-round">extension</span>
            <span>{t('nav.puzzle')}</span>
          </button>

          <button
            className={`bottom-nav-item ${isActive('/records') ? 'active' : ''}`}
            onClick={() => navigate('/records')}
          >
            <span className="material-icons-round">history</span>
            <span>{t('nav.records')}</span>
          </button>

          <button
            className={`bottom-nav-item ${isActive('/profile') ? 'active' : ''}`}
            onClick={() => navigate('/profile')}
          >
            <span className="material-icons-round">person</span>
            <span>{t('nav.profile')}</span>
          </button>
        </div>
      </nav>
      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </>
  );
}

export default BottomNav;
