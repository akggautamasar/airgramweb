import React, { useEffect, useState } from 'react';
import { QrCode, Smartphone, KeyRound, ShieldCheck, Loader2, RefreshCw, ArrowRight } from 'lucide-react';
import { apiFetch } from '../api';

export default function LoginView({ onAuthenticated }) {
  const [tab, setTab] = useState('qr'); // 'qr' | 'phone' | 'key'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // QR State
  const [qrLoginId, setQrLoginId] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrStatus, setQrStatus] = useState('idle'); // idle | waiting | needs_2fa | verifying_2fa
  const [qrHint, setQrHint] = useState('');
  const [qr2faPassword, setQr2faPassword] = useState('');

  // Phone + 2FA State
  const [phoneStep, setPhoneStep] = useState('phone'); // 'phone' | 'code' | '2fa'
  const [phoneLoginId, setPhoneLoginId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phone2faPassword, setPhone2faPassword] = useState('');
  const [phoneHint, setPhoneHint] = useState('');

  // Session Key State
  const [sessionKey, setSessionKey] = useState('');

  const initQr = async () => {
    setError('');
    setQrStatus('loading');
    try {
      const data = await apiFetch('/api/auth/qr/start', { method: 'POST' });
      setQrLoginId(data.loginId);
      setQrDataUrl(data.qrDataUrl || '');
      setQrStatus(data.status || 'waiting');
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err.message);
      setQrStatus('error');
    }
  };

  useEffect(() => {
    if (tab === 'qr' && !qrLoginId) {
      initQr();
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== 'qr' || !qrLoginId || (qrStatus !== 'waiting' && qrStatus !== 'verifying_2fa')) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/auth/qr/status/${qrLoginId}`);
        if (res.qrDataUrl) setQrDataUrl(res.qrDataUrl);
        if (res.status === 'needs_2fa') {
          setQrStatus('needs_2fa');
          setQrHint(res.hint || '');
        } else if (res.status === 'authenticated' && res.auth) {
          clearInterval(timer);
          onAuthenticated(res.auth);
        } else if (res.status === 'error' || res.status === 'expired') {
          clearInterval(timer);
          setQrStatus('error');
          setError(res.error || 'QR session expired. Refresh to try again.');
        }
      } catch (err) {
        // Ignore transient poll errors
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [tab, qrLoginId, qrStatus]);

  const handleQr2faSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch('/api/auth/qr/2fa', {
        method: 'POST',
        body: JSON.stringify({ loginId: qrLoginId, password: qr2faPassword }),
      });
      setQrStatus('verifying_2fa');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendPhone = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/api/auth/phone/start', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });
      setPhoneLoginId(data.loginId);
      setPhoneStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/api/auth/phone/verify-code', {
        method: 'POST',
        body: JSON.stringify({ loginId: phoneLoginId, code: phoneCode.trim() }),
      });
      if (data.status === 'needs_2fa') {
        setPhoneHint(data.hint || '');
        setPhoneStep('2fa');
      } else if (data.status === 'authenticated') {
        onAuthenticated(data.auth);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyPhone2fa = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/api/auth/phone/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ loginId: phoneLoginId, password: phone2faPassword }),
      });
      if (data.status === 'authenticated') {
        onAuthenticated(data.auth);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSessionLogin = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ sessionString: sessionKey.trim() }),
      });
      if (data.status === 'authenticated') {
        onAuthenticated(data.auth);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 16px',
        background:
          'radial-gradient(circle at 50% 0%, rgba(51, 71, 216, 0.22), transparent 55%), var(--bg)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 520, marginBottom: 24 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <img
            src="/airgram-icon.svg"
            alt="AirGram"
            style={{ width: 44, height: 44, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,191,216,0.28)' }}
          />
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>AirGram</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.025em' }}>
          Stream Telegram Library
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55 }}>
          Connect your Telegram account once to unlock and stream your Telegram library directly with
          zero buffering — even on slow connections.
        </p>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 22,
          padding: 26,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              margin: '0 auto 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(59, 130, 246, 0.14)',
              border: '1px solid rgba(59, 130, 246, 0.28)',
              color: '#38bdf8',
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <h2 style={{ margin: '0 0 4px', fontSize: 21, fontWeight: 700 }}>Connect Telegram</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            One-time connection to stream Telegram library
          </p>
        </div>

        {/* 3-Mode Segmented Control */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
            padding: 5,
            borderRadius: 13,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            marginBottom: 22,
          }}
        >
          {[
            { id: 'qr', label: 'QR Scan', icon: QrCode },
            { id: 'phone', label: 'Phone + 2FA', icon: Smartphone },
            { id: 'key', label: 'Paste Key', icon: KeyRound },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setError('');
                  setTab(item.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '9px 8px',
                  borderRadius: 9,
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? 'linear-gradient(135deg, #2563eb, #0ea5e9)' : 'transparent',
                  color: active ? '#ffffff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* TAB 1: QR SCAN */}
        {tab === 'qr' && (
          <div>
            {qrStatus === 'needs_2fa' ? (
              <form onSubmit={handleQr2faSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  Your account has Two-Step Verification enabled. Enter your cloud password
                  {qrHint ? ` (Hint: ${qrHint})` : ''}:
                </div>
                <input
                  type="password"
                  className="input"
                  placeholder="Telegram 2FA Password"
                  value={qr2faPassword}
                  onChange={(e) => setQr2faPassword(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? <Loader2 size={16} className="spin" /> : 'Verify & Connect'}
                </button>
              </form>
            ) : (
              <>
                <div
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 16,
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 240,
                    marginBottom: 18,
                  }}
                >
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Telegram Login QR Code"
                      style={{
                        width: 210,
                        height: 210,
                        borderRadius: 12,
                        background: '#ffffff',
                        padding: 8,
                      }}
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
                      <Loader2 size={28} className="spin" />
                      <span style={{ fontSize: 13 }}>Generating QR code...</span>
                    </div>
                  )}
                  {qrStatus === 'error' && (
                    <button type="button" className="btn" style={{ marginTop: 12 }} onClick={initQr}>
                      <RefreshCw size={14} /> Refresh QR
                    </button>
                  )}
                </div>

                <ol
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    color: 'var(--text-muted)',
                    fontSize: 13,
                    lineHeight: 1.75,
                  }}
                >
                  <li>
                    Open <strong style={{ color: 'var(--text)' }}>Telegram</strong> on your phone
                  </li>
                  <li>
                    Go to <strong style={{ color: 'var(--text)' }}>Settings → Devices</strong>
                  </li>
                  <li>
                    Tap <strong style={{ color: 'var(--text)' }}>Link Desktop Device</strong> and scan
                  </li>
                </ol>
              </>
            )}
          </div>
        )}

        {/* TAB 2: PHONE + OTP + 2FA */}
        {tab === 'phone' && (
          <div>
            {phoneStep === 'phone' && (
              <form onSubmit={handleSendPhone} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Mobile Number (with country code, e.g. +919876543210)
                </label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+91 98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? <Loader2 size={16} className="spin" /> : <>Send OTP <ArrowRight size={15} /></>}
                </button>
              </form>
            )}

            {phoneStep === 'code' && (
              <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Enter the OTP sent to your Telegram app for <strong>{phoneNumber}</strong>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="5-digit Telegram code"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  required
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setPhoneStep('phone');
                      setPhoneCode('');
                    }}
                  >
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
                    {busy ? <Loader2 size={16} className="spin" /> : 'Verify Code'}
                  </button>
                </div>
              </form>
            )}

            {phoneStep === '2fa' && (
              <form onSubmit={handleVerifyPhone2fa} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Two-Step Verification Password{phoneHint ? ` (Hint: ${phoneHint})` : ''}
                </label>
                <input
                  type="password"
                  className="input"
                  placeholder="Enter 2FA password"
                  value={phone2faPassword}
                  onChange={(e) => setPhone2faPassword(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? <Loader2 size={16} className="spin" /> : 'Unlock & Connect'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 3: SESSION STRING (PASTE KEY) */}
        {tab === 'key' && (
          <form onSubmit={handleSessionLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Paste your <strong style={{ color: 'var(--text)' }}>AirGram / StringSession Key</strong> from
              Saved Messages for instant login without QR or OTP:
            </label>
            <textarea
              className="input"
              rows={4}
              placeholder="Paste your session key here..."
              value={sessionKey}
              onChange={(e) => setSessionKey(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : 'Instant Login with Key'}
            </button>
          </form>
        )}

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          🔐 After QR or Phone login, a backup Session Key is sent to your{' '}
          <strong style={{ color: 'var(--text)' }}>Saved Messages</strong> for instant future logins.
        </div>
      </div>
    </div>
  );
}
