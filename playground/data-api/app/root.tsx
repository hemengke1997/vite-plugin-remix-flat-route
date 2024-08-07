import { AnimatePresence, motion } from 'framer-motion'
import { type PropsWithChildren } from 'react'
import { Link, ScrollRestoration, useLocation, useOutlet, useRouteError } from 'react-router-dom'

export const Wrapper = ({ children }: PropsWithChildren) => {
  const location = useLocation()
  return (
    <AnimatePresence mode={'wait'} initial={false}>
      <motion.div
        key={location.pathname}
        initial={{
          translateX: 10,
          opacity: 0,
        }}
        animate={{ translateX: 0, opacity: 1 }}
        exit={{ translateX: -10, opacity: 0 }}
        transition={{ duration: 1 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export default function Root() {
  const outlet = useOutlet()
  return (
    <>
      <Wrapper>
        <Link to='/'>go home</Link>
        {outlet}
      </Wrapper>
      <ScrollRestoration />
    </>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  console.log(error)

  return <>Oops!</>
}
