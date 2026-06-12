import MarketingFooter from './_components/MarketingFooter'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <MarketingFooter />
    </>
  )
}
