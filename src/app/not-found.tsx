import Link from "next/link";
import { BrandLink } from "@/components/brand";
import { HeaderBand } from "@/components/header-band";
import { PageMain } from "@/components/page-main";
import { Heading, linkClass } from "@/components/ui";
import { VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";
import { t } from "@/lib/i18n";

// The band left the root layout (QW1), so the 404 brings its own, and a way back.
export default function NotFound() {
  return (
    <>
      <HeaderBand venue={VENUE_LAYER_DEFAULT} brand={<BrandLink venue={VENUE_LAYER_DEFAULT} />} />
      <PageMain>
        <Heading>{t("notFound.title")}</Heading>
        <Link href="/" className={`${linkClass} self-start`}>
          {t("notFound.home")}
        </Link>
      </PageMain>
    </>
  );
}
