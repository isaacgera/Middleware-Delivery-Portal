/** Login view — temporary username/password form (Entra ID comes later). */
import { login } from '../session.js';
import { ApiError } from '../api.js';

export function renderLogin(view, onSuccess) {
  view.innerHTML = `
    <div class="login-wrap">
      <form class="card login-card" id="login-form" novalidate>
        <h1 style="margin-top:0;">Sign in</h1>
        <p class="muted" style="margin-top:0;">Middleware Delivery Portal</p>

        <label class="field">
          <span>Username</span>
          <input id="login-username" name="username" type="text" autocomplete="username"
            required autofocus />
        </label>

        <label class="field">
          <span>Password</span>
          <input id="login-password" name="password" type="password"
            autocomplete="current-password" required />
        </label>

        <div id="login-error" class="form-error" role="alert" hidden></div>

        <button class="btn-primary" type="submit" id="login-submit">Sign in</button>

        <p class="muted login-hint">
          Prototype logins: <code>admin</code> / <code>admin123</code> &middot;
          <code>manager</code> / <code>manager123</code>
        </p>
      </form>
    </div>
  `;

  const form = view.querySelector('#login-form');
  const errorEl = view.querySelector('#login-error');
  const submitBtn = view.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const username = view.querySelector('#login-username').value.trim();
    const password = view.querySelector('#login-password').value;

    if (!username || !password) {
      errorEl.textContent = 'Please enter your username and password.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    try {
      await login(username, password);
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Could not sign in. Is the server running?';
      errorEl.textContent = msg;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
}
