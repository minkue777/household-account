export function normalizeLoanRepaymentMethod(
  value: string,
): "equal-principal-and-interest" | "equal-principal" | "bullet" | undefined {
  const token = value.toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
  const mapping = Object.freeze({
    "equal-principal-and-interest": "equal-principal-and-interest",
    "equal-principal": "equal-principal",
    bullet: "bullet",
    원리금균등상환: "equal-principal-and-interest",
    원금균등상환: "equal-principal",
    만기일시상환: "bullet",
  } as const);
  return mapping[token as keyof typeof mapping];
}
