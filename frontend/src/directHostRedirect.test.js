import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import config from '../../vercel.json'

const { convertRedirects } = createRequire(import.meta.url)('next/dist/compiled/@vercel/routing-utils')
const routes = convertRedirects(config.redirects || [], 308)
const directHost = 'cliff-watch.vercel.app'
const publicUrl = 'https://www.policyengine.org/us/cliffwatch'

function redirect(path, forwardedHost = directHost) {
  for (const route of routes) {
    const pathPattern = new RegExp(route.src)
    const matchesHost = (route.has || []).every(condition =>
      condition.type === 'header' && condition.key === 'x-forwarded-host' &&
      new RegExp(`^(?:${condition.value})$`).test(forwardedHost),
    )
    if (matchesHost && pathPattern.test(path)) {
      return [route.status, path.replace(pathPattern, route.headers.Location)]
    }
  }
  return null
}

test.each(['/', '/cliffwatch-og.png', '/example/', '/apix'])('redirects a direct visit to %s', path => {
  expect(redirect(path)).toEqual([308, publicUrl + (path === '/' ? '' : path)])
})

test.each(['/api/calculate', '/api/series', '/api/households', '/api/metadata'])('keeps %s on the compute host', path => {
  expect(redirect(path)).toBeNull()
})

test.each(['www.policyengine.org', 'policyengine.org', 'cliff-watch-preview-policy-engine.vercel.app', 'cliff-watchXvercelXapp'])('leaves requests through %s alone', host => {
  expect(redirect('/', host)).toBeNull()
  expect(redirect('/cliffwatch-og.png', host)).toBeNull()
})
