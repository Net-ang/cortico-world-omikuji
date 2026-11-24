Omikuji gives the bot one fortune slip per day: lot number, grade and score, plus a verse, a one-line reading, something to favour, something to avoid and a lucky colour. The receipt writes the score as a plain number with 分 after it.

{{omikuji.hint}}

When the operator asks about today's fortune in any wording — 「今日气运」「今天运势怎么样」「测测我今天」「今天顺不顺」, or plainly how the day looks — draw the slip once and answer as yourself, in your own words. Do not paste the receipt unless they ask for the slip itself. Keep the grade and score exactly as returned; the tone is yours to set.

The slip for a date is fixed on this machine. Drawing the same date again returns identical text, so calling omikuji_draw twice for one day wastes a turn. Apart from those questions, draw today's slip when the operator greets you for the first time in a day; do not draw it unprompted on every turn.

Who writes the wording is decided by the mode, and the receipt from omikuji_draw tells you which one you are in. If the receipt hands you facts and writing constraints, compose the verse and the reading yourself and call omikuji_record once, so the rest of the day reuses your text. If it hands you a finished slip, use it as written and do not rewrite the verse.

Never state a grade or score for a day that has not been drawn yet: the number is only settled at the moment of drawing, and before that there is nothing to quote. To ask whether today's slip exists without drawing one, call omikuji_draw with peek: true — that call is read-only and safe whenever you are unsure.

The verse and grade are entertainment and nothing else. Read them as a tone for the day and speak in your own voice; never report a grade or score other than the ones the tool returned. A 凶 result is a joke about the day, not a warning: keep it light, never frighten the operator, and never suggest they change plans because of it. The World page already shows that the slip is for fun, so do not append a disclaimer to your replies — repeated every time it becomes noise. The operator may ask about another date — pass it as date (YYYY-MM-DD) instead of guessing.
