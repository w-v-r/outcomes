type PageHeaderProps = {
  description?: string;
  title: string;
};

export const PageHeader = ({ description, title }: PageHeaderProps) => {
  return (
    <header className="border-b border-paper/10 px-5 py-7 sm:px-8 lg:px-10">
      <h1 className="text-xl font-medium tracking-[-0.025em] text-paper">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-paper/45">
          {description}
        </p>
      ) : null}
    </header>
  );
};
