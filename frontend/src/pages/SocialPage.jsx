import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import BottomNav from '../components/BottomNav';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useFriendlyMatchSocket } from '../hooks/useFriendlyMatchSocket';

function SocialPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [villains, setVillains] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);
  const {
    pendingInvite,
    matchReady,
    sendInvite,
    acceptInvite,
    declineInvite,
    clearPendingInvite,
    clearMatchReady,
  } = useFriendlyMatchSocket();

  const showToast = useCallback((message) => {
    if (!message) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const response = await axios.get('/api/social/friends');
      setFriends(response.data || []);
    } catch {
      showToast(t('social.loadFriendsFailed'));
    }
  }, [showToast, t]);

  const loadVillains = useCallback(async () => {
    try {
      const response = await axios.get('/api/social/villains');
      setVillains(response.data || []);
    } catch {
      showToast(t('social.loadVillainsFailed'));
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!user) return;
    loadFriends();
    loadVillains();
  }, [loadFriends, loadVillains, user]);

  const handleSearchUsers = async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await axios.get('/api/social/users/search', { params: { q } });
      setSearchResults(response.data || []);
    } catch {
      showToast(t('social.searchFailed'));
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async (targetUserId) => {
    try {
      await axios.post('/api/social/friends', { targetUserId });
      showToast(t('social.friendAdded'));
      await loadFriends();
      await handleSearchUsers();
    } catch (err) {
      if (err.response?.status === 409) {
        showToast(t('social.cannotAddBlockedUser'));
        return;
      }
      showToast(t('social.friendAddFailed'));
    }
  };

  const handleRemoveFriend = async (friendId) => {
    try {
      await axios.delete(`/api/social/friends/${friendId}`);
      showToast(t('social.friendRemoved'));
      await loadFriends();
      await handleSearchUsers();
    } catch {
      showToast(t('social.friendRemoveFailed'));
    }
  };

  const handleAddVillain = async (targetUserId) => {
    try {
      await axios.post('/api/social/villains', { targetUserId });
      showToast(t('social.villainAdded'));
      await Promise.all([loadFriends(), loadVillains(), handleSearchUsers()]);
    } catch {
      showToast(t('social.villainAddFailed'));
    }
  };

  const handleRemoveVillain = async (targetUserId) => {
    try {
      await axios.delete(`/api/social/villains/${targetUserId}`);
      showToast(t('social.villainRemoved'));
      await Promise.all([loadVillains(), handleSearchUsers()]);
    } catch {
      showToast(t('social.villainRemoveFailed'));
    }
  };

  const handleSendFriendlyRequest = async (targetUserId) => {
    const response = await sendInvite(targetUserId);
    if (response?.ok) {
      showToast(t('social.friendlyInviteSent'));
      return;
    }
    if (response?.error === 'TARGET_OFFLINE') {
      showToast(t('social.friendOffline'));
      return;
    }
    if (response?.error === 'BLOCKED_USER') {
      showToast(t('social.blockedCannotInvite'));
      return;
    }
    showToast(t('social.friendlyInviteFailed'));
  };

  const handleAcceptInvite = async () => {
    if (!pendingInvite?.inviteId) return;
    const response = await acceptInvite(pendingInvite.inviteId);
    if (!response?.ok) {
      showToast(t('social.inviteAcceptFailed'));
    }
  };

  const handleDeclineInvite = async () => {
    if (!pendingInvite?.inviteId) {
      clearPendingInvite();
      return;
    }
    await declineInvite(pendingInvite.inviteId);
  };

  const handleStartFriendlyMatch = () => {
    if (!matchReady?.matchId) return;
    const matchId = matchReady.matchId;
    clearMatchReady();
    navigate(`/game?mode=friendly&matchId=${matchId}`);
  };

  return (
    <>
      <header className="records-header">
        <button className="header-icon-btn" onClick={() => navigate('/')}>
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1>{t('social.title')}</h1>
        <div style={{ width: 40 }} />
      </header>

      <div className="social-page page-with-nav">
        <div className="social-tabs">
          <button
            type="button"
            className={`social-tab ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setActiveTab('friends')}
          >
            {t('social.friendsTab')}
          </button>
          <button
            type="button"
            className={`social-tab ${activeTab === 'villains' ? 'active' : ''}`}
            onClick={() => setActiveTab('villains')}
          >
            {t('social.villainsTab')}
          </button>
        </div>

        {activeTab === 'friends' && (
          <>
            <section className="social-search-card">
              <div className="social-search-row">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('social.searchPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchUsers();
                  }}
                />
                <button type="button" onClick={handleSearchUsers} disabled={searching}>
                  {t('social.search')}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="social-search-results">
                  {searchResults.map((candidate) => (
                    <div className="social-person-row" key={candidate.id}>
                      <div className="social-person-main">
                        <strong>{candidate.nickname}</strong>
                        <span>@{candidate.username}</span>
                      </div>
                      <div className="social-person-actions">
                        {!candidate.is_friend && (
                          <button type="button" className="social-btn primary" onClick={() => handleAddFriend(candidate.id)}>
                            {t('social.addFriend')}
                          </button>
                        )}
                        {candidate.is_friend && (
                          <span className="social-badge">{t('social.alreadyFriend')}</span>
                        )}
                        {!candidate.is_villain && (
                          <button type="button" className="social-btn danger" onClick={() => handleAddVillain(candidate.id)}>
                            {t('social.addVillain')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="social-list-card">
              <h3>{t('social.friendsList')}</h3>
              {friends.length === 0 && (
                <div className="page-empty" style={{ padding: '18px 0' }}>
                  <span className="material-icons-round">group_off</span>
                  <span>{t('social.noFriends')}</span>
                </div>
              )}
              {friends.map((friend) => (
                <div className="social-person-row" key={friend.id}>
                  <div className="social-person-main">
                    <strong>{friend.nickname}</strong>
                    <span>{friend.rank || '-'} · {friend.rating ?? '-'}</span>
                  </div>
                  <div className="social-person-actions">
                    <button type="button" className="social-btn primary" onClick={() => handleSendFriendlyRequest(friend.id)}>
                      {t('social.requestFriendly')}
                    </button>
                    <button type="button" className="social-btn" onClick={() => navigate(`/social/friend/${friend.id}/records`)}>
                      {t('social.viewFriendRecords')}
                    </button>
                    <button type="button" className="social-btn" onClick={() => handleRemoveFriend(friend.id)}>
                      {t('social.removeFriend')}
                    </button>
                    <button type="button" className="social-btn danger" onClick={() => handleAddVillain(friend.id)}>
                      {t('social.addVillain')}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {activeTab === 'villains' && (
          <section className="social-list-card">
            <h3>{t('social.villainsList')}</h3>
            {villains.length === 0 && (
              <div className="page-empty" style={{ padding: '18px 0' }}>
                <span className="material-icons-round">shield</span>
                <span>{t('social.noVillains')}</span>
              </div>
            )}
            {villains.map((villain) => (
              <div className="social-person-row" key={villain.id}>
                <div className="social-person-main">
                  <strong>{villain.nickname}</strong>
                  <span>{villain.rank || '-'} · {villain.rating ?? '-'}</span>
                </div>
                <div className="social-person-actions">
                  <button type="button" className="social-btn" onClick={() => handleRemoveVillain(villain.id)}>
                    {t('social.removeVillain')}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      {pendingInvite && (
        <div className="menu-confirm-overlay" onClick={handleDeclineInvite}>
          <div className="menu-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-confirm-title">
              {t('social.friendlyInviteReceived', { nickname: pendingInvite.from?.nickname || '-' })}
            </div>
            <div className="menu-confirm-actions">
              <button className="menu-confirm-btn secondary" type="button" onClick={handleDeclineInvite}>
                {t('common.no')}
              </button>
              <button className="menu-confirm-btn primary" type="button" onClick={handleAcceptInvite}>
                {t('common.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {matchReady && (
        <div className="menu-confirm-overlay" onClick={handleStartFriendlyMatch}>
          <div className="menu-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-confirm-title">
              {t('social.friendlyMatchReady', { nickname: matchReady.opponent?.nickname || '-' })}
            </div>
            <div className="menu-confirm-actions">
              <button className="menu-confirm-btn primary" type="button" style={{ gridColumn: '1 / -1' }} onClick={handleStartFriendlyMatch}>
                {t('social.startMatch')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
      <BottomNav />
    </>
  );
}

export default SocialPage;
