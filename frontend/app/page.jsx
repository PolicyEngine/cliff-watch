import ClientApp from "./ClientApp";

// Server-rendered crawler-visible content. The interactive app is hydrated
// client-side via `<ClientApp />`. CliffWatch is a static export, so this
// markup is what crawlers (Googlebot, Bingbot, social previews) see before
// JavaScript executes.
export default function Page() {
  return (
    <>
      <section
        className="seo-static-content"
        aria-hidden="false"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        <h1>CliffWatch — PolicyEngine benefit cliff explorer</h1>
        <p>
          CliffWatch is a free, open-source tool from PolicyEngine that maps
          benefit cliffs and marginal tax rates for US households. Enter a
          household&apos;s state, marital status, number of dependents, and
          starting income to see how net resources change as wages and salaries
          rise, with cliff zones, dead zones, and program-level contributions
          (SNAP, TANF, EITC, CTC, Medicaid, CHIP, ACA premium tax credits, WIC,
          housing assistance, child care subsidies, Head Start, and more)
          highlighted along the curve.
        </p>
        <h2>What CliffWatch shows</h2>
        <ul>
          <li>Net household income as wages and salaries rise</li>
          <li>Benefit cliffs where small wage gains cause large net losses</li>
          <li>Marginal tax rates across the income distribution</li>
          <li>Program-level breakdowns for federal and state benefits and taxes</li>
          <li>Side-by-side comparisons across all 50 US states and DC</li>
        </ul>
        <h2>Programs modeled</h2>
        <p>
          SNAP, TANF, EITC, Child Tax Credit, Medicaid, CHIP, ACA premium tax
          credits, WIC, free school meals, Head Start, Early Head Start, child
          care subsidies, housing assistance, SSI, and federal and state income
          taxes including refundable tax credits.
        </p>
      </section>
      <ClientApp />
    </>
  );
}
