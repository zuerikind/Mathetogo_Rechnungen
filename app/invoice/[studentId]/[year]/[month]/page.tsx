import { InvoicePreviewClient } from "@/components/InvoicePreviewClient";

type Props = {
  params: {
    studentId: string;
    year: string;
    month: string;
  };
};

export default function InvoicePreviewPage({ params }: Props) {
  return (
    <InvoicePreviewClient
      studentId={params.studentId}
      year={Number(params.year)}
      month={Number(params.month)}
    />
  );
}
