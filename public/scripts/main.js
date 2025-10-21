(function () {
  const navLinks = document.querySelectorAll('[data-nav-link]');
  const rawPath = window.location.pathname.replace(/\/index\.html$/, '/');
  const currentPath = normalizePath(rawPath);

  navLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    if (href === '/' && currentPath === '/') {
      link.classList.add('active');
      return;
    }
    if (href !== '/' && currentPath.startsWith(href)) {
      link.classList.add('active');
    }
  });

  const pageKey = document.body?.dataset?.page;
  if (pageKey) {
    updateVisitCounter(pageKey);
  }

  setupContactForm();
  setupAiChat();
  loadGalleryMedia();
  setupNsfwAccess();

  function updateVisitCounter(key) {
    fetch(`/api/visits/${encodeURIComponent(key)}`, {
      method: 'POST'
    })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to update visits')))
      .then((data) => {
        const el = document.querySelector('[data-visit-count]');
        if (el && data?.count !== undefined) {
          el.textContent = Number(data.count).toLocaleString();
        }
      })
      .catch((err) => {
        console.warn('visit counter failed', err);
      });
  }

  function setupContactForm() {
    const form = document.querySelector('#contact-form');
    if (!form) return;

    const status = document.querySelector('#contact-status');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      form.classList.add('is-submitting');
      if (status) {
        status.textContent = 'Sending your message...';
      }

      const formData = new FormData(form);
      const interests = form.querySelectorAll('input[name="interest"]:checked');
      const selectedInterests = Array.from(interests).map((item) => item.value);

      const payload = {
        firstName: formData.get('firstName')?.trim(),
        lastName: formData.get('lastName')?.trim(),
        email: formData.get('email')?.trim(),
        mobile: formData.get('mobile')?.trim(),
        discord: formData.get('discord')?.trim(),
        message: formData.get('message')?.trim(),
        interests: selectedInterests
      };

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.error || 'Unable to send message');
        }

        if (status) {
          status.innerHTML = `✅ ${result.message}<br />Your MembersOnly access code: <strong>${result.accessCode}</strong>`;
        }
        form.reset();
      } catch (error) {
        console.error(error);
        if (status) {
          status.textContent = `⚠️ ${error.message}`;
        }
      } finally {
        form.classList.remove('is-submitting');
      }
    });
  }

  function setupAiChat() {
    const form = document.querySelector('#ai-chat-form');
    const log = document.querySelector('#ai-chat-log');
    const input = document.querySelector('#ai-chat-input');
    const status = document.querySelector('#ai-chat-status');

    if (!form || !log || !input) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) {
        return;
      }

      appendMessage('user', prompt);
      input.value = '';
      if (status) status.textContent = 'Thinking...';

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        const result = await response.json();
        if (!response.ok) {
          const errorMessage = pickErrorMessage(result);
          const enrichedError = new Error(errorMessage);
          enrichedError.details = result;
          throw enrichedError;
        }
        appendMessage('ai', formatAiReply(result.reply));
      } catch (error) {
        appendMessage('ai', `Something went wrong: ${normaliseErrorMessage(error)}`);
      } finally {
        if (status) status.textContent = '';
      }
    });

    function appendMessage(role, content) {
      const bubble = document.createElement('div');
      bubble.className = `chat-message ${role}`;
      bubble.textContent = content;
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
    }
  }

  function loadGalleryMedia() {
    const galleryGrid = document.querySelector('#gallery-grid');
    const galleryStatus = document.querySelector('#gallery-status');
    if (!galleryGrid) return;

    fetch('/api/gallery')
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to load gallery')))
      .then(({ items }) => {
        galleryGrid.innerHTML = '';
        if (!items || !items.length) {
          galleryGrid.innerHTML = '<p>No media yet. Upload to the R2 bucket to populate this gallery.</p>';
          return;
        }

        items.forEach((item) => {
          const card = document.createElement('article');
          card.className = 'gallery-card';
          const media = createMediaElement(item);
          card.appendChild(media);
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.innerHTML = `
            <strong>${item.name}</strong><br />
            ${(item.size / 1024).toFixed(1)} KB
          `;
          card.appendChild(meta);
          galleryGrid.appendChild(card);
        });
      })
      .catch((error) => {
        console.error(error);
        if (galleryStatus) {
          galleryStatus.textContent = 'Unable to load gallery right now.';
        }
      });

    function createMediaElement(item) {
      const mime = item.contentType || '';
      if (!item.url) {
        const placeholder = document.createElement('div');
        placeholder.className = 'notice';
        placeholder.textContent = 'Upload media to R2 to render previews.';
        return placeholder;
      }
      const source = item.url;
      if (mime.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = source;
        video.controls = true;
        video.preload = 'metadata';
        return video;
      }
      const img = document.createElement('img');
      img.src = source;
      img.alt = item.name;
      return img;
    }
  }

  function setupNsfwAccess() {
    const loginForm = document.querySelector('#nsfw-login-form');
    const logoutButton = document.querySelector('#nsfw-logout');
    const status = document.querySelector('#nsfw-status');
    const mediaContainer = document.querySelector('#nsfw-media');

    if (loginForm) {
      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(loginForm);
        const payload = {
          email: formData.get('email')?.trim(),
          accessCode: formData.get('accessCode')?.trim()
        };

        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result?.error || 'Unable to authenticate');
          }
          if (status) {
            status.textContent = 'You are now signed in. Loading content...';
          }
          loginForm.reset();
          await loadMembersOnlyMedia();
        } catch (error) {
          if (status) status.textContent = `⚠️ ${error.message}`;
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (status) status.textContent = 'Signed out. Please authenticate again to view NSFW content.';
        if (mediaContainer) mediaContainer.innerHTML = '';
      });
    }

    async function loadMembersOnlyMedia() {
      try {
        const response = await fetch('/api/nsfw/content', { credentials: 'include' });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.error || 'Unable to load Member content');
        }
        renderMembersMedia(result.media || []);
      } catch (error) {
        if (status) status.textContent = `⚠️ ${error.message}`;
      }
    }

    function renderMembersMedia(items) {
      if (!mediaContainer) return;
      mediaContainer.innerHTML = '';
      if (!items.length) {
        mediaContainer.innerHTML = '<p>Upload content to the R2 nsfw/ prefix to populate this feed.</p>';
        return;
      }
      items.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'gallery-card';
        const mediaEl = document.createElement(item.contentType?.startsWith('video/') ? 'video' : 'img');
        if (mediaEl.tagName === 'VIDEO') {
          mediaEl.controls = true;
        }
        mediaEl.src = `/media/nsfw/${encodeURIComponent(item.key)}`;
        mediaEl.alt = item.name;
        card.appendChild(mediaEl);
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = item.name;
        card.appendChild(meta);
        mediaContainer.appendChild(card);
      });
    }

    const pageRequiresAuth = document.body?.dataset?.page === 'nsfw';
    if (pageRequiresAuth) {
      loadMembersOnlyMedia();
    }
  }

  function normalizePath(path) {
    if (path === '/tospolicy' || path === '/tospolicy.html') {
      return '/privacy';
    }
    if (path === '/nfsw' || path === '/nfsw.html') {
      return '/nsfw';
    }
    return path;
  }

  function pickErrorMessage(payload) {
    if (!payload) return 'AI is unavailable right now';
    if (typeof payload === 'string') return payload;
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
    if (Array.isArray(payload.errors) && payload.errors.length) {
      const first = payload.errors[0];
      if (typeof first === 'string') return first;
      if (first && typeof first.message === 'string') return first.message;
    }
    return 'AI is unavailable right now';
  }

  function normaliseErrorMessage(error) {
    if (!error) return 'AI is unavailable right now';
    if (typeof error.message === 'string' && error.message !== '[object Object]') {
      return error.message;
    }
    if (error.details) {
      return pickErrorMessage(error.details);
    }
    return 'AI is unavailable right now';
  }

  function formatAiReply(reply) {
    if (typeof reply === 'string') {
      const trimmed = reply.trim();
      if (trimmed) return trimmed;
    }
    if (reply && typeof reply === 'object') {
      try {
        return JSON.stringify(reply, null, 2);
      } catch (error) {
        // noop — fall through to default message
      }
    }
    return 'Here to help!';
  }
})();
