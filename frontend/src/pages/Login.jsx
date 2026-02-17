import { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

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
    <div style={{ width: '100%', maxWidth: 360, padding: 20, textAlign: 'center', margin: '0 auto' }}>
      <h2>{t('login.title')}</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300, margin: '0 auto' }}>
        <input 
          placeholder={t('login.idPlaceholder')}
          value={username} 
          onChange={e => setUsername(e.target.value)} 
          required 
        />
        <input 
          type="password" 
          placeholder={t('login.passwordPlaceholder')}
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          required 
        />
        <button type="submit">{t('login.submit')}</button>
      </form>
      <p>
        {t('login.noAccount')} <Link to="/register">{t('login.goRegister')}</Link>
      </p>
    </div>
  );
}

export default Login;
