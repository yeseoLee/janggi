import { useLanguage } from '../context/LanguageContext';

function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="language-switcher" role="group" aria-label={t('common.language')}>
      <span className="language-label">{t('common.language')}</span>
      <button
        type="button"
        className={`language-btn ${language === 'ko' ? 'active' : ''}`}
        onClick={() => setLanguage('ko')}
      >
        {t('common.korean')}
      </button>
      <button
        type="button"
        className={`language-btn ${language === 'en' ? 'active' : ''}`}
        onClick={() => setLanguage('en')}
      >
        {t('common.english')}
      </button>
    </div>
  );
}

export default LanguageSelector;
