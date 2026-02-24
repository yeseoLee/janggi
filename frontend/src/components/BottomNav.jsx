import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const path = location.pathname;

  const isActive = (target) => path === target;

  return (
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
          className={`bottom-nav-item ${isActive('/game') ? 'active' : ''}`}
          onClick={() => navigate('/game?mode=online')}
        >
          <span className="material-icons-round">sports_esports</span>
          <span>{t('nav.match')}</span>
        </button>

        <div className="bottom-nav-play-spacer" />
        <div className="bottom-nav-play-wrap">
          <button
            className="bottom-nav-play-btn"
            onClick={() => navigate('/game?mode=ai')}
          >
            <span className="material-icons-round">play_arrow</span>
          </button>
        </div>

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
  );
}

export default BottomNav;
