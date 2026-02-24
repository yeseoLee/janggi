import { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/auth/register', { username, password, nickname });
      alert(t('register.success'));
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.error || t('register.failed'));
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-lattice-bg" />

      <div className="auth-logo">
        <div className="auth-logo-diamond">
          <div className="auth-logo-diamond-bg" />
          <div className="auth-logo-diamond-inner" />
          <span className="auth-logo-char">漢</span>
        </div>
        <h1>{t('register.appTitle')}</h1>
        <p>Master Janggi</p>
      </div>

      <div className="auth-form-card">
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('register.idLabel')}</label>
            <div className="auth-input-wrapper">
              <span className="material-icons-round">person</span>
              <input
                className="auth-input"
                placeholder={t('register.idPlaceholder')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label>{t('register.passwordLabel')}</label>
            <div className="auth-input-wrapper">
              <span className="material-icons-round">lock</span>
              <input
                className="auth-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label>{t('register.nicknameLabel')}</label>
            <div className="auth-input-wrapper">
              <span className="material-icons-round">badge</span>
              <input
                className="auth-input"
                placeholder={t('register.nicknamePlaceholder')}
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '4px' }}>
            <button type="submit" className="auth-submit-btn">
              {t('register.submit')}
            </button>

            <div className="auth-divider">
              <span>{t('register.or')}</span>
            </div>

            <Link to="/login" className="auth-secondary-btn">
              {t('register.goLogin')}
            </Link>
          </div>
        </form>
      </div>

      <p className="auth-footer">© 2024 Janggi Master. All rights reserved.</p>
    </div>
  );
}

export default Register;
