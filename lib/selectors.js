export const SELECTORS = Object.freeze({
  version: 1,
  lastVerified: '2026-05-29',

  x: Object.freeze({
    post:         'article[data-testid="tweet"]',
    comment:      'article[data-testid="tweet"]',
    actionRow:    'div[role="group"]',
    replyButton:  'button[data-testid="reply"]',
    replyTextbox: 'div[data-testid^="tweetTextarea_"][contenteditable="true"]',
    embedQuote:   'div[role="link"] article[data-testid="tweet"]',
  }),

  fb: Object.freeze({
    post:         'div[role="article"]',
    comment:      'div[role="article"]',
    actionRow:    'div[role="presentation"]',
    replyButton:  'div[role="button"][aria-label*="Comment" i], div[role="button"][aria-label*="Reply" i]',
    replyTextbox: 'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
    skipUrlPrefixes: ['/marketplace/', '/reels/', '/stories/'],
  }),
});
