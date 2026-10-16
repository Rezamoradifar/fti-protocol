# iPhone layout follow-up

Panel language select had a 14px rule overriding the mobile 16px input rule. Set it explicitly to 16px and normalize text-size-adjust in the panel. Add vh fallbacks before dvh menu limits for older browsers. No contracts or financial logic changed.

Validation: web and landing builds passed. 28 Chromium layout cases passed (panel EN/FA, dark/light, 320/390/844/1280; public routes 320/390/844). These do not establish actual iPhone rendering.

WebKit downloaded locally but launch was blocked by missing system libraries; dependency installation failed with host setgroups permissions. Added WebKit mobile/touch test mode and a GitHub Actions WebKit check. Its result must be inspected; no local WebKit or real-device success is claimed. The reported visual issue may require a screenshot and iOS/browser version to reproduce fully.

The live /app/ HTML was read and already references the prior panel-identity overlay. This patch still requires the standard landing and UI installers.
