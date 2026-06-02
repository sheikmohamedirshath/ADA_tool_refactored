const RULE_FIX_TIPS = {
  'aria-allowed-attr': [
    'Remove ARIA attributes not supported for this element or role.',
    'Prefer native HTML semantics first; add ARIA only when necessary and valid.',
  ],
  'aria-required-attr': [
    'Add required ARIA attributes for the current role.',
    'Verify the role/attribute combination against ARIA spec.',
  ],
  'aria-valid-attr': [
    'Use valid ARIA attribute names only.',
    'Fix typos and remove custom/non-standard aria-* attributes.',
  ],
  'aria-valid-attr-value': [
    'Use supported values for ARIA attributes.',
    'For boolean ARIA values, use "true" or "false".',
  ],
  'autocomplete-valid': [
    'Use valid autocomplete tokens (for example: name, email, organization, street-address).',
    'Remove invalid or custom autocomplete values.',
  ],
  'button-name': [
    'Add accessible text to the button (visible text or aria-label/aria-labelledby).',
    'If icon-only, keep aria-label concise and descriptive.',
  ],
  'color-contrast': [
    'Increase text/background contrast to meet WCAG thresholds.',
    'Check hover, focus, and disabled states too, not only the default state.',
  ],
  'frame-title': [
    'Add a clear, unique title attribute to each frame/iframe.',
    'Make the title describe the embedded content purpose.',
  ],
  'heading-order': [
    'Use heading levels in sequence (h1 -> h2 -> h3).',
    'Do not skip levels for visual styling only.',
  ],
  'html-has-lang': [
    'Add a valid lang attribute on the <html> element.',
    'Use BCP 47 language tags such as en, en-US, fr, etc.',
  ],
  'image-alt': [
    'Add meaningful alt text for informative images.',
    'Use empty alt="" only for decorative images.',
  ],
  label: [
    'Associate each form control with a visible <label>.',
    'For custom components, use aria-labelledby or aria-label correctly.',
  ],
  'link-name': [
    'Ensure every link has discernible text (or aria-label/aria-labelledby).',
    'Avoid empty links and links with only decorative icons without labels.',
  ],
  'list-item': [
    'Ensure <li> elements are children of <ul> or <ol>.',
    'Do not use list styling without semantic list markup.',
  ],
  'meta-viewport': [
    'Set a responsive viewport meta tag.',
    'Avoid disabling zoom (do not use user-scalable=no).',
  ],
  region: [
    'Use landmark regions (<main>, <nav>, <header>, <footer>, <aside>) for structure.',
    'Ensure important page sections are inside landmarks.',
  ],
}

const RULE_FIX_EXAMPLES = {
  'aria-allowed-attr': [
    { label: 'Use valid ARIA on supported role', code: '<div role="button" aria-pressed="false">Toggle</div>' },
  ],
  'aria-required-attr': [
    { label: 'Required ARIA for combobox', code: '<input role="combobox" aria-expanded="false" aria-controls="city-list" />' },
  ],
  'aria-valid-attr': [
    { label: 'Valid aria-* usage', code: '<button aria-label="Close dialog">×</button>' },
  ],
  'aria-valid-attr-value': [
    { label: 'Boolean aria value', code: '<button aria-expanded="true">Filters</button>' },
  ],
  'autocomplete-valid': [
    { label: 'Valid autocomplete token', code: '<input type="email" autocomplete="email" />' },
  ],
  'button-name': [
    { label: 'Icon-only button', code: '<button aria-label="Open chat"><img src="/chat.svg" alt="" /></button>' },
    { label: 'Visible text', code: '<button type="button">Open chat</button>' },
  ],
  'color-contrast': [
    { label: 'Increase contrast', code: '.btn { color: #111827; background: #ffffff; }' },
  ],
  'frame-title': [
    { label: 'Accessible iframe title', code: '<iframe src="/report" title="Accessibility report"></iframe>' },
  ],
  'heading-order': [
    { label: 'Sequential headings', code: '<h1>Page</h1><h2>Section</h2><h3>Subsection</h3>' },
  ],
  'html-has-lang': [
    { label: 'Language on root html', code: '<html lang="en">' },
  ],
  'image-alt': [
    { label: 'Informative image', code: '<img src="/chart.png" alt="Quarterly sales chart for 2026" />' },
    { label: 'Decorative image', code: '<img src="/divider.png" alt="" role="presentation" />' },
  ],
  label: [
    { label: 'Explicit label', code: '<label for="email">Email</label><input id="email" type="email" />' },
  ],
  'link-name': [
    { label: 'Label icon link', code: '<a href="/home" aria-label="Home"><svg aria-hidden="true"></svg></a>' },
  ],
  'list-item': [
    { label: 'Semantic list', code: '<ul><li>Step one</li><li>Step two</li></ul>' },
  ],
  'meta-viewport': [
    { label: 'Responsive viewport', code: '<meta name="viewport" content="width=device-width, initial-scale=1" />' },
  ],
  region: [
    { label: 'Main landmark', code: '<main><h1>Accessibility report</h1></main>' },
  ],
}

function normalizeRuleId(ruleId) {
  return (ruleId || '').toLowerCase()
}

export function getRuleFixTips(ruleId) {
  return RULE_FIX_TIPS[normalizeRuleId(ruleId)] || []
}

export function getRuleFixExamples(ruleId) {
  return RULE_FIX_EXAMPLES[normalizeRuleId(ruleId)] || []
}

export function splitFailureSummary(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}
