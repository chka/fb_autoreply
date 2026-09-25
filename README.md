# AIreply

A Chrome extension that puts an AIreply button on posts and comments on Facebook and X. Click it, pick a tone and a length, and you get a draft reply written in the language of the post you're answering. You can edit the draft, regenerate it or throw it away. When you hit Send it goes into the platform's own reply box, and nothing is posted until you submit it there yourself.

## Install

The extension isn't on the Chrome Web Store yet, so load it unpacked:

1. Clone this repo.
2. Open `chrome://extensions` and switch on Developer mode.
3. Click "Load unpacked" and pick the repo folder.
4. Open the extension's options page and paste in your API key.

No build step. The extension runs straight from the source files.

## API key

Drafts are generated through [Ringside](https://ringside.fightclub.pro), an OpenAI-compatible LLM API. Create a key at `ringside.fightclub.pro/app/api-keys/new` (it starts with `ko_`) and paste it into the options page. The key stays in `chrome.storage.local` and is only ever sent to `api.fightclub.pro`.

The default model is `fc:openai/gpt-4o`. Any model ref Ringside accepts works, so `fc:anthropic/claude-sonnet-5` is fine too. There's an optional customer tag if you want usage attributed to a Ringside customer.

## Tones and lengths

The menu is a grid of six tones against three lengths.

| Tone | What you get |
|---|---|
| Polite | Formal and courteous, no slang |
| Nice | Warm and casual |
| Information | Neutral and factual, citing up to three web search results |
| Bad | Dismissive pushback on the claim |
| Ugly | Sarcastic and condescending about the argument |
| Curse | Vulgar and mocking, profanity allowed |

Short is capped at 255 characters. Medium is two or three sentences. Long is deliberately repetitive and over-explained, because sometimes that's the point.

The Information tone runs a DuckDuckGo search on the post and passes the top results to the model. You can turn that off in the options page.

## Guard rails

Every draft goes through a local filter before you see it. It blocks threats of violence and anything that looks like doxing, such as a phone number or a street address. There's also a slur check, but the list in `lib/safety.js` ships as a placeholder. Supply your own list if you want that check to do anything.

Generation is capped at 30 drafts an hour per platform, counted locally.

## Development

```
npm install
npm test
```

Tests run on Vitest with jsdom. Facebook and X change their markup often. When the button stops showing up, `lib/selectors.js` is the first place to look.

## License

MIT. See [LICENSE](LICENSE).
