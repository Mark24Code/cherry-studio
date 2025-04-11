import { FC } from 'react'

interface Props {
  disabled: boolean
  sendMessage: () => void
  ref: any
}

const SendMessageButton: FC<Props> = ({ disabled, sendMessage, ref}) => {
  return (
    <i
      ref={ref}
      className="iconfont icon-ic_send"
      onClick={sendMessage}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
        fontSize: 22,
        transition: 'all 0.2s',
        marginRight: 2
      }}
    />
  )
}

export default SendMessageButton
