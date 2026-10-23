// Supabase SDK loaded before this script; session stays scoped to this page's origin.
let memberClient = null;
let activeMember = null;
let submissionBusy = false;
let requestIdentityCache = null;

async function initializeMemberLogin() {
  try {
    const response = await fetch('/api/member-config');
    if (!response.ok) throw new Error('Member login is temporarily unavailable.');
    const config = await response.json();
    memberClient = window.supabase.createClient(config.url, config.publishableKey);
    memberClient.auth.onAuthStateChange((_event, session) => { activeMember = session; if (!submissionBusy) updateMemberGate(); });
    const { data } = await memberClient.auth.getSession();
    activeMember = data.session;
    updateMemberGate();
  } catch (error) { showError('email-error', error.message); }
}

function updateMemberGate() {
  const signedIn = Boolean(activeMember?.user);
  document.getElementById('member-password-field').hidden = signedIn;
  document.getElementById('user-email').readOnly = signedIn;
  if (signedIn) document.getElementById('user-email').value = activeMember.user.email || '';
  document.getElementById('member-login-help').hidden = signedIn;
  document.getElementById('member-sign-out').hidden = !signedIn;
  document.getElementById('member-gate-button').textContent = signedIn ? 'Show My Pathway · 1 credit' : 'Log in & Show My Pathway';
}

async function signOutMember() {
  if (submissionBusy || !memberClient) return;
  await memberClient.auth.signOut();
  activeMember = null;
  requestIdentityCache = null;
  document.getElementById('user-email').value = '';
  updateMemberGate();
}

async function submitMemberGuide(payload) {
  if (submissionBusy) return;
  submissionBusy = true;
  const button = document.getElementById('member-gate-button');
  button.disabled = true;
  button.textContent = 'Building your pathway…';
  hideError('email-error');
  try {
    if (!memberClient) throw new Error('Member login is temporarily unavailable. Please reload and try again.');
    if (!activeMember) {
      const email = document.getElementById('user-email').value.trim();
      const password = document.getElementById('member-password').value;
      const { data, error } = await memberClient.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error('We could not log you in. Check your email and password.');
      activeMember = data.session;
      document.getElementById('member-password').value = '';
    }
    const { data } = await memberClient.auth.getSession();
    activeMember = data.session;
    if (!activeMember?.access_token || !activeMember.user?.id) throw new Error('Please log in again.');
    const fingerprint = JSON.stringify(payload);
    // Only request identifiers are stored; no answers or tokens are copied into this record.
    const storageKey = `start-here-request:${activeMember.user.id}`;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))).map(b => b.toString(16).padStart(2, '0')).join('');
    if (!requestIdentityCache) {
      try { requestIdentityCache = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { requestIdentityCache = null; }
    }
    if (!requestIdentityCache || requestIdentityCache.fingerprint !== digest) requestIdentityCache = { key: crypto.randomUUID(), fingerprint: digest };
    sessionStorage.setItem(storageKey, JSON.stringify(requestIdentityCache));
    const response = await fetch('/api/planner', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeMember.access_token}`, 'Idempotency-Key': requestIdentityCache.key },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) activeMember = null;
      if (response.status === 402 || result.code === 'GENERATION_REFUNDED' || result.code === 'MEMBER_RECORD_MISSING') { requestIdentityCache = null; sessionStorage.removeItem(storageKey); }
      throw new Error(response.status === 402 ? 'You have no credits remaining. Visit your Frequency Tool Suite account to check your membership.' : result.error || 'Your guide could not be completed. Retry this same request later.');
    }
    return result;
  } catch (error) { showError('email-error', error.message); }
  finally { submissionBusy = false; button.disabled = false; updateMemberGate(); }
}

function clearGuideRequest() {
  if (submissionBusy) return false;
  if (activeMember?.user?.id) sessionStorage.removeItem(`start-here-request:${activeMember.user.id}`);
  requestIdentityCache = null;
  return true;
}
initializeMemberLogin();