export const SELECTORS = Object.freeze({
  version: 1,
  lastVerified: '2026-09-25',

  x: Object.freeze({
    post:         'article[data-testid="tweet"]',
    comment:      'article[data-testid="tweet"]',
    actionRow:    'div[role="group"]',
    replyButton:  'button[data-testid="reply"]',
    replyTextbox: 'div[data-testid^="tweetTextarea_"][contenteditable="true"]',
    embedQuote:   'div[role="link"] article[data-testid="tweet"]',
  }),

  fb: Object.freeze({
    // Feed and dialog posts carry aria-posinset, not role=article; only comments are articles.
    post:         'div[aria-posinset], div[role="article"]',
    comment:      'div[role="article"]',
    actionRow:    'div[role="presentation"]',
    replyButton:  'div[role="button"][aria-label="Leave a comment" i], div[role="button"][aria-label="Comment" i]',
    replyTextbox: 'div[contenteditable="true"][role="textbox"]',
    skipUrlPrefixes: ['/marketplace/', '/reels/', '/stories/'],
  }),
});
