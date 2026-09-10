import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0'

type PushCommit = {
  id?: string
  message?: string
  url?: string
  author?: { email?: string; name?: string }
  committer?: { email?: string; name?: string }
}

function extractNodeId(message = '') {
  return message.match(/\bRG-\d{3,}\b/i)?.[0]?.toUpperCase()
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await request.text()
  const webhookSecret = Deno.env.get('GIT_WEBHOOK_SECRET')
  const githubSignature = request.headers.get('x-hub-signature-256')
  const giteeToken = request.headers.get('x-gitee-token')

  if (!webhookSecret) return new Response('Webhook secret is not configured', { status: 500 })

  let authorized = giteeToken === webhookSecret
  if (githubSignature?.startsWith('sha256=')) {
    const expected = await hmacHex(webhookSecret, body)
    authorized = constantTimeEqual(githubSignature.slice(7), expected)
  }
  if (!authorized) return new Response('Invalid signature', { status: 401 })

  const payload = JSON.parse(body)
  const commits: PushCommit[] = payload.commits ?? []
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  let inserted = 0

  for (const commit of commits) {
    const nodeId = extractNodeId(commit.message)
    const email = (commit.author?.email ?? commit.committer?.email ?? '').toLowerCase()
    if (!nodeId || !email) continue

    const [{ data: workItem }, { data: members }] = await Promise.all([
      supabase.from('work_items').select('id,title').eq('id', nodeId).maybeSingle(),
      supabase.from('team_members').select('id,name,git_emails'),
    ])
    const member = members?.find((candidate) =>
      (candidate.git_emails ?? []).map((entry: string) => entry.toLowerCase()).includes(email),
    )
    if (!workItem || !member) continue

    const shortSha = commit.id?.slice(0, 7) ?? 'commit'
    const title = `${shortSha} · ${(commit.message ?? '').split('\n')[0]}`.slice(0, 240)
    const { error } = await supabase.from('evidence').insert({
      id: `EV-GIT-${commit.id}`,
      work_item_id: nodeId,
      actor_id: member.id,
      title,
      kind: 'code',
      url: commit.url ?? null,
      accepted: false,
    })
    if (!error) inserted += 1
  }

  return Response.json({ inserted })
})
