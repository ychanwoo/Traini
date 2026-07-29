import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

const styles = {
  primary: "bg-[#6B21A8] text-white hover:bg-[#581C87]",
  secondary: "border border-[#DED7E2] bg-white text-[#1F1726] hover:bg-[#FAF8FB]",
  ghost: "bg-transparent text-[#6B21A8] hover:bg-[#F3E8FF]",
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={`flex h-[52px] w-full items-center justify-center rounded-2xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
