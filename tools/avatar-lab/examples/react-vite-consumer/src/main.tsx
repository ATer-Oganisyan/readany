import { validateAvatarDefinition, type AvatarDefinition } from '@bible-strong/avatar-core'
import { Avatar, createAvatar } from '@bible-strong/avatar-react'
import '@bible-strong/avatar-react/styles.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import definitionJson from './strobi.avatar.json'
import './styles.css'

const validation = validateAvatarDefinition(definitionJson)
if (!validation.ok) throw new Error(validation.errors[0]?.message)
const definition = validation.value as AvatarDefinition
const StrobiAvatar = createAvatar(definitionJson)
type StrobiExpressionKey = keyof typeof definitionJson.expressions
const expressions = Object.keys(definition.expressions) as StrobiExpressionKey[]
const horizontalPosition = (expression: string) =>
  expression.includes('left') ? 'left' : expression.includes('right') ? 'right' : 'center'
const verticalPosition = (expression: string) =>
  expression.includes('up') ? 'up' : expression.includes('down') ? 'down' : 'middle'
const expressionGroups = [
  ['up', 'left', 'Up left'],
  ['up', 'center', 'Up'],
  ['up', 'right', 'Up right'],
  ['middle', 'left', 'Left'],
  ['middle', 'center', 'Neutral'],
  ['middle', 'right', 'Right'],
  ['down', 'left', 'Down left'],
  ['down', 'center', 'Down'],
  ['down', 'right', 'Down right'],
].map(([vertical, horizontal, label]) => ({
  key: `${vertical}-${horizontal}`,
  label,
  expressions: expressions.filter(
    expression =>
      verticalPosition(expression) === vertical && horizontalPosition(expression) === horizontal
  ),
}))

const formatExpressionName = (expression: string) =>
  expression.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

function Demo() {
  const [expression, setExpression] = useState<StrobiExpressionKey>('neutral')

  return (
    <main>
      <h1>Avatar package consumer</h1>
      <section className="avatar-host" aria-label="Embedded avatar example">
        <Avatar
          definition={definition}
          expression={expression}
          size={240}
          ariaLabel="Embedded Strobi avatar"
        />
      </section>
      <section className="expression-picker" aria-labelledby="expression-picker-title">
        <div className="expression-picker__heading">
          <h2 id="expression-picker-title">Available expressions ({expressions.length})</h2>
          <output aria-live="polite">Active: {formatExpressionName(expression)}</output>
        </div>
        <div className="expression-picker__list">
          {expressionGroups.map(group => (
            <section
              key={group.key}
              className={`expression-picker__group expression-picker__group--${group.key}`}
            >
              <h3>{group.label}</h3>
              <div className="expression-picker__group-list">
                {group.expressions.map(key => (
                  <button
                    key={key}
                    type="button"
                    className={key === expression ? 'is-selected' : undefined}
                    aria-pressed={key === expression}
                    onClick={() => setExpression(key)}
                  >
                    {formatExpressionName(key)}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <div className="avatar-overlay" aria-label="Positioned avatar example">
        <Avatar
          definition={definition}
          expression={expression}
          size={128}
          ariaLabel="Positioned Strobi avatar"
        />
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>
)
