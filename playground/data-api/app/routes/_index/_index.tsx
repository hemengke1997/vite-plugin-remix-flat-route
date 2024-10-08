import { type LoaderFunction } from 'react-router-dom'
import { useBearStore } from '../../store'

export const handle = {
  test: '测试一下handle',
}

export const lazy = async () => ({
  Component: (await import('./_index.lazy')).default,
})

export const loader: LoaderFunction = (args) => {
  console.log(useBearStore.getState().bears, 'bears')
  console.log('this is loader', args)
  return null
}
