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
    <div style={{ width: '100%', maxWidth: 360, padding: 20, textAlign: 'center', margin: '0 auto' }}>
      <h2>{t('register.title')}</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300, margin: '0 auto' }}>
        <input 
          placeholder={t('register.idPlaceholder')}
          value={username} 
          onChange={e => setUsername(e.target.value)} 
          required 
        />
        <input 
          type="password" 
          placeholder={t('register.passwordPlaceholder')}
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          required 
        />
        <input 
          placeholder={t('register.nicknamePlaceholder')}
          value={nickname} 
          onChange={e => setNickname(e.target.value)} 
          required 
        />
        <button type="submit">{t('register.submit')}</button>
      </form>
      <p>
        {t('register.haveAccount')} <Link to="/login">{t('register.goLogin')}</Link>
      </p>
    </div>
  );
}

export default Register;
