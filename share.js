(function () {
    'use strict';

    const SEARCH_API_URL = 'https://sch.sooplive.com/api.php';
    const THEME_STORAGE_KEY = 'soop-recap-share-theme';
    const TYPE_LABELS = ['LIVE', 'VOD', 'LIVE + VOD'];
    const avatarUrlCache = new Map();

    function isLightThemeActive() {
        return document.body.classList.contains('light-theme');
    }

    function updateThemeToggleLabel() {
        const button = document.getElementById('share-theme-toggle');
        if (!button) return;
        const lightMode = isLightThemeActive();
        button.textContent = lightMode ? '다크모드' : '라이트모드';
        button.setAttribute('aria-pressed', String(!lightMode));
    }

    function applyTheme(theme) {
        const useLightTheme = theme !== 'dark';
        document.body.classList.toggle('light-theme', useLightTheme);
        updateThemeToggleLabel();
    }

    function loadThemePreference() {
        try {
            return window.localStorage.getItem(THEME_STORAGE_KEY) || 'light';
        } catch {
            return 'light';
        }
    }

    function saveThemePreference(theme) {
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // Ignore storage failures and keep the in-memory theme only.
        }
    }

    function toggleTheme() {
        const nextTheme = isLightThemeActive() ? 'dark' : 'light';
        applyTheme(nextTheme);
        saveThemePreference(nextTheme);
    }

    function base64UrlToUint8Array(value) {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    async function decodeSharePayloadFromHash() {
        const rawHash = window.location.hash.replace(/^#/, '');
        const match = rawHash.match(/^v1\.(g|j)\.(.+)$/u);
        if (!match) {
            throw new Error('지원하지 않는 공유 링크 형식입니다.');
        }

        const [, mode, encoded] = match;
        const bytes = base64UrlToUint8Array(encoded);
        let jsonText = '';

        if (mode === 'g') {
            if (typeof DecompressionStream !== 'function') {
                throw new Error('이 브라우저는 압축된 공유 링크 복원을 지원하지 않습니다.');
            }
            const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            jsonText = await new Response(decompressedStream).text();
        } else {
            jsonText = new TextDecoder().decode(bytes);
        }

        const payload = JSON.parse(jsonText);
        validatePayload(payload);
        return payload;
    }

    function validatePayload(payload) {
        if (!payload || payload.v !== 1) {
            throw new Error('지원하지 않는 payload 버전입니다.');
        }
        if (!Array.isArray(payload.rs)) {
            throw new Error('순위 데이터가 없습니다.');
        }
        if (!String(payload.msg || '').trim()) {
            throw new Error('인증 메시지가 없습니다.');
        }
    }

    function formatMonthLabel(monthValue) {
        if (!monthValue || String(monthValue).length < 6) return String(monthValue || '-');
        const monthText = String(monthValue);
        return `${monthText.slice(0, 4)}년 ${Number(monthText.slice(4, 6))}월`;
    }

    function formatSecondsToHM(seconds) {
        const totalMinutes = Math.round(Number(seconds || 0) / 60);
        if (totalMinutes < 1) return '1분 미만';
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (hours > 0) parts.push(`${hours}시간`);
        if (minutes > 0) parts.push(`${minutes}분`);
        return parts.join(' ') || '0분';
    }

    function formatTypeLabel(typeValue) {
        return TYPE_LABELS[Number(typeValue)] || TYPE_LABELS[0];
    }

    function formatGeneratedAt(timestampSeconds) {
        if (!timestampSeconds) return '-';
        const date = new Date(Number(timestampSeconds) * 1000);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function createPlaceholderAvatar(name) {
        const initial = escapeHtml(String(name || '?').trim().charAt(0) || '?');
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
                <rect width="96" height="96" rx="26" fill="#dff5f1" />
                <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
                    font-family="Pretendard, Noto Sans KR, sans-serif" font-size="34" font-weight="700" fill="#0f766e">${initial}</text>
            </svg>
        `.trim();
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function getPreferredProfileImageUrl(originalUrl) {
        const sourceUrl = String(originalUrl || '').trim();
        if (!sourceUrl) return '';

        try {
            const url = new URL(sourceUrl);
            const isSoopProfileImage = url.hostname === 'profile.img.sooplive.com';
            const hasConvertibleExtension = /\.(?:jpe?g|png)$/iu.test(url.pathname);

            if (isSoopProfileImage && hasConvertibleExtension) {
                url.pathname = url.pathname.replace(/\.(?:jpe?g|png)$/iu, '.webp');
                return url.toString();
            }
        } catch {
            // Fall through to the original URL when parsing fails.
        }

        return sourceUrl;
    }

    function handleAvatarLoadError(event) {
        const image = event.currentTarget;
        if (!(image instanceof HTMLImageElement)) return;

        const fallbackSrc = image.dataset.fallbackSrc || '';
        if (fallbackSrc && image.src !== fallbackSrc) {
            image.src = fallbackSrc;
            image.removeAttribute('data-fallback-src');
            return;
        }

        image.src = createPlaceholderAvatar(image.dataset.streamerName || '?');
    }

    function buildRankings(payload) {
        return payload.rs.slice(0, 10).map((entry, index) => ({
            rank: index + 1,
            name: String(entry?.[0] || '알 수 없음'),
            seconds: Math.max(0, Number(entry?.[1] || 0)),
        }));
    }

    function formatSharePercent(seconds, totalSeconds) {
        if (!totalSeconds) return '0.0%';
        return `${((seconds / totalSeconds) * 100).toFixed(1)}%`;
    }

    async function getStreamerProfileUrl(originalNick) {
        if (avatarUrlCache.has(originalNick)) {
            return avatarUrlCache.get(originalNick);
        }

        const search = async (term) => {
            const response = await fetch(`${SEARCH_API_URL}?m=searchHistory&service=list&d=${encodeURIComponent(term)}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data?.suggest_bj?.find(item => item.user_nick === originalNick)?.station_logo || null;
        };

        try {
            let logo = await search(originalNick);
            if (!logo) {
                const sanitized = originalNick.replace(/[^\p{L}\p{N}\s]/gu, '');
                if (sanitized && sanitized !== originalNick) {
                    logo = await search(sanitized);
                }
            }
            avatarUrlCache.set(originalNick, logo);
            return logo;
        } catch {
            avatarUrlCache.set(originalNick, null);
            return null;
        }
    }

    async function hydrateAvatars() {
        const avatarElements = Array.from(document.querySelectorAll('[data-streamer-name]'));
        await Promise.all(avatarElements.map(async element => {
            const name = element.dataset.streamerName;
            const profileUrl = await getStreamerProfileUrl(name);
            if (profileUrl) {
                const preferredProfileUrl = getPreferredProfileImageUrl(profileUrl);
                if (preferredProfileUrl !== profileUrl) {
                    element.dataset.fallbackSrc = profileUrl;
                } else {
                    element.removeAttribute('data-fallback-src');
                }
                element.src = preferredProfileUrl;
            }
        }));
    }

    function renderPayload(payload) {
        const rankings = buildRankings(payload);
        const totalSeconds = Math.max(0, Number(payload.tw || 0));
        const attendanceValue = Math.max(0, Number(payload.ad || 0));
        const monthLabel = formatMonthLabel(payload.m);
        const typeLabel = formatTypeLabel(payload.t);
        const generatedAtLabel = formatGeneratedAt(payload.g);

        document.getElementById('share-title').textContent = `${monthLabel} 시청 요약`;
        document.getElementById('share-header-meta').textContent = `${typeLabel} · 공유 시각 ${generatedAtLabel}`;
        document.getElementById('share-proof-message-display').textContent = payload.msg;
        document.getElementById('summary-total-time').textContent = formatSecondsToHM(totalSeconds);
        document.getElementById('summary-attendance').innerHTML = `${attendanceValue}<span class="unit">일</span>`;
        document.getElementById('share-footer-month').textContent = monthLabel;

        const rankingList = document.getElementById('ranking-list');
        rankingList.innerHTML = rankings.map(item => `
            <article class="rank-item" data-rank="${item.rank}">
                <div class="rank-item-bar" style="width: ${formatSharePercent(item.seconds, totalSeconds)};"></div>
                <div class="rank-item-content">
                    <div class="rank-item-number">${item.rank}</div>
                    <img class="rank-item-avatar" data-streamer-name="${escapeHtml(item.name)}" src="${createPlaceholderAvatar(item.name)}" alt="${escapeHtml(item.name)}">
                    <div class="rank-item-name">${escapeHtml(item.name)}</div>
                    <div class="rank-item-stats">
                        <div class="rank-item-time">${formatSecondsToHM(item.seconds)}</div>
                        <div class="rank-item-share">${formatSharePercent(item.seconds, totalSeconds)}</div>
                    </div>
                </div>
            </article>
        `).join('');

        document.getElementById('share-content').hidden = false;
        document.querySelectorAll('.rank-item-avatar').forEach(image => {
            image.addEventListener('error', handleAvatarLoadError);
        });
    }

    function showError(message) {
        document.getElementById('share-title').textContent = '공유 리캡을 열 수 없습니다';
        document.getElementById('share-error-message').textContent = message;
        document.getElementById('share-error').hidden = false;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        applyTheme(loadThemePreference());
        document.getElementById('share-theme-toggle')?.addEventListener('click', toggleTheme);

        try {
            const payload = await decodeSharePayloadFromHash();
            renderPayload(payload);
            hydrateAvatars();
        } catch (error) {
            showError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
        }
    });
})();
