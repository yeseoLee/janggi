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
    <div className="screen-centered auth-page">
      <h2 className="auth-title">{t('register.title')}</h2>
      {error && <p className="auth-error">{error}</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          className="auth-input"
          placeholder={t('register.idPlaceholder')}
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />
        <input
          className="auth-input"
          type="password"
          placeholder={t('register.passwordPlaceholder')}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <input
          className="auth-input"
          placeholder={t('register.nicknamePlaceholder')}
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          required
        />
        <button type="submit" className="auth-submit-btn">{t('register.submit')}</button>
      </form>
      <p className="auth-link-row">
        {t('register.haveAccount')} <Link to="/login">{t('register.goLogin')}</Link>
      </p>
    </div>
  );
}

export default Register;
