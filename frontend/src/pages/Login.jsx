import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, token, user } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    if (token && user) {
      navigate('/', { replace: true });
    }
  }, [navigate, token, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/auth/login', { username, password });
      login(res.data.token, res.data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || t('login.failed'));
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
        <h1>{t('login.appTitle')}</h1>
        <p>Master Janggi</p>
      </div>

      <div className="auth-form-card">
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t('login.idLabel')}</label>
            <div className="auth-input-wrapper">
              <span className="material-icons-round">person</span>
              <input
                className="auth-input"
                placeholder={t('login.idPlaceholder')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label>{t('login.passwordLabel')}</label>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '4px' }}>
            <button type="submit" className="auth-submit-btn">
              {t('login.submit')}
            </button>

            <div className="auth-divider">
              <span>{t('login.or')}</span>
            </div>

            <Link to="/register" className="auth-secondary-btn">
              {t('login.goRegister')}
            </Link>
          </div>
        </form>
      </div>

      <p className="auth-footer">© 2024 Janggi Master. All rights reserved.</p>
    </div>
  );
}

export default Login;
