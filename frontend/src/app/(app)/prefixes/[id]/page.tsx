"use client";

import {useParams} from "next/navigation";

import {PrefixDetailPage} from "../../../../views/prefix-detail-page";

export default function PrefixDetailRoute() {
  const params = useParams();
  const id = params?.id as string;
  return <PrefixDetailPage prefixId={id} />;
}
