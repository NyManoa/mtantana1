import { Layout } from "@/components/Layout";
import { TransactionTable } from "@/components/TransactionTable";
import { useAuth } from "@/lib/auth";
import { useTransactions } from "@/lib/useTransactions";
import { t } from "@/lib/i18n";

export function TransactionsPage() {
  const { profile, lang } = useAuth();
  const { transactions, categories, validationThreshold, createTransaction, updateTransaction, deleteTransaction, validateTransaction } = useTransactions();

  const role = profile?.role ?? "operateur";
  const showAuthor = role === "admin" || role === "superviseur";

  return (
    <Layout
      title={t(lang, "transactions")}
      subtitle={showAuthor ? t(lang, "allTransactions") : t(lang, "yourTransactions")}
    >
      <TransactionTable
        lang={lang}
        rows={transactions}
        role={role}
        showAuthor={showAuthor}
        categories={categories}
        validationThreshold={validationThreshold}
        onCreate={createTransaction}
        onUpdate={updateTransaction}
        onDelete={deleteTransaction}
        onValidate={role === "admin" ? validateTransaction : undefined}
      />
    </Layout>
  );
}
