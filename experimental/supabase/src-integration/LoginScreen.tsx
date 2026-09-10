import { useState, type FormEvent } from 'react'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'

interface LoginScreenProps {
  onSendMagicLink: (email: string) => Promise<void>
}

export function LoginScreen({ onSendMagicLink }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    setError('')
    try {
      await onSendMagicLink(email.trim())
      setSent(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '登录邮件发送失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <img src="/project-mark.svg" alt="" width="46" height="46" />
        <span className="dialog-kicker">具身项目依赖台</span>
        <h1>{sent ? '检查登录邮件' : '进入团队审计台'}</h1>
        {sent ? (
          <p>登录链接已发送到 <strong>{email}</strong>。链接只用于确认团队身份。</p>
        ) : (
          <>
            <p>使用团队登记邮箱登录。进度、证据与审计操作会关联到你的身份。</p>
            <form onSubmit={submit}>
              <label htmlFor="login-email">团队邮箱</label>
              <div className="email-field">
                <Mail size={17} />
                <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="primary-button" disabled={sending}>
                {sending ? '发送中' : '发送登录链接'} <ArrowRight size={16} />
              </button>
            </form>
          </>
        )}
        <footer><ShieldCheck size={15} /> 只有数据库中登记的四名成员可以修改项目。</footer>
      </section>
    </main>
  )
}
