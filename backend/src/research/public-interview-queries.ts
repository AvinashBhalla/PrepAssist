export type InterviewQueryInput = {
  companyName: string;
  roleTitle?: string;
};

export function buildInterviewQueries(input: InterviewQueryInput): string[] {
  const company = input.companyName.trim();
  const role = input.roleTitle?.trim();
  if (!company) return [];

  const queries = [
    `${company} interview process`,
    `${company} software engineer interview`,
    ...(role ? [`${company} ${role} interview`] : []),
    `${company} technical interview`,
    `${company} hiring process`,
    `site:reddit.com ${company} interview`,
    `site:glassdoor.com ${company} interview`,
  ];

  return [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()))];
}
