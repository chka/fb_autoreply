# Installing AIreply

AIreply isn't in the Chrome Web Store or on addons.mozilla.org yet. You load it from source. There's no build step, so a clone of this repo is the extension.

```
git clone git@github.com:chka/fb_autoreply.git
```

You'll also need a Ringside API key. Create one at `ringside.fightclub.pro/app/api-keys/new`. It starts with `ko_` and is only shown once, so copy it before you leave the page.

## Chrome

The same steps work in Edge, Brave and any other Chromium browser.

1. Go to `chrome://extensions`.
2. Turn on Developer mode (top right).
3. Click Load unpacked and select the `fb_autoreply` folder, the one with `manifest.json` in it.
4. Click Details on the AIreply card, then Extension options. Paste your API key, hit Test, then Save.
5. Reload any Facebook or X tab you already had open.

Chrome keeps an unpacked extension installed across restarts. It may nag you about developer-mode extensions on startup. Dismiss it.

## Firefox

Needs Firefox 128 or newer.

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on and select `manifest.json` inside the `fb_autoreply` folder.
3. Go to `about:addons`, open AIreply and switch to the Permissions tab. Turn on every site listed there.
4. Open the Options tab on the same page. Paste your API key, hit Test, then Save.
5. Reload any Facebook or X tab you already had open.

Step 3 matters. Firefox treats site access for Manifest V3 extensions as opt-in, and until you grant it the button never shows up and drafts fail because the extension can't reach the API.

A temporary add-on is removed when Firefox quits, so you repeat steps 1 and 2 after every restart. Your settings survive, because they're tied to the add-on ID in the manifest.

To keep it installed for good, it needs signing by Mozilla. With an API key from addons.mozilla.org you can sign it as an unlisted add-on and install the `.xpi` that comes back:

```
npx web-ext sign --channel=unlisted --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
```

Firefox Developer Edition and Nightly can skip signing instead. Set `xpinstall.signatures.required` to `false` in `about:config`, zip the folder contents and install the zip from `about:addons`.

## Updating

Pull the latest code, then reload the extension. In Chrome that's the circular arrow on the AIreply card in `chrome://extensions`. In Firefox, click Reload next to AIreply in `about:debugging`. Refresh open Facebook and X tabs afterwards, since the old content script stays on a page until it reloads.

## If the button doesn't appear

Check that the platform is switched on in the options page, and in Firefox check the Permissions tab again. After that, open the browser console on the page. The extension logs `AIreply: content-fb loaded` or `AIreply: content-x loaded` when it starts. If that line is there and the button still doesn't show, Facebook or X has probably changed its markup, and the selectors in `lib/selectors.js` need updating.
