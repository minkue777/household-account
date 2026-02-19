import { ReactNode } from 'react';

type ButtonVariant = 'outline' | 'primary' | 'danger' | 'neutral' | 'accent';
type ButtonSize = 'default' | 'large';

interface ActionButtonConfig {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
}

interface ExpenseActionButtonsProps {
  leftButton?: ActionButtonConfig;
  rightButton: ActionButtonConfig;
  size?: ButtonSize;
  className?: string;
}

function getButtonVariantClassName(variant: ButtonVariant): string {
  switch (variant) {
    case 'outline':
      return 'border border-slate-300 text-slate-600 hover:bg-slate-50';
    case 'danger':
      return 'bg-red-500 text-white hover:bg-red-600';
    case 'neutral':
      return 'bg-slate-200 text-slate-800 hover:bg-slate-300';
    case 'accent':
      return 'bg-purple-500 text-white hover:bg-purple-600';
    case 'primary':
    default:
      return 'bg-blue-500 text-white hover:bg-blue-600';
  }
}

function getButtonSizeClassName(size: ButtonSize): string {
  if (size === 'large') {
    return 'py-2.5 px-4 rounded-xl';
  }
  return 'py-2 px-4 rounded-lg';
}

function ActionButton({
  label,
  onClick,
  variant = 'primary',
  disabled,
  icon,
  size,
}: ActionButtonConfig & { size: ButtonSize }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 ${getButtonSizeClassName(size)} transition-colors font-medium flex items-center justify-center gap-1.5 disabled:bg-slate-300 disabled:cursor-not-allowed ${getButtonVariantClassName(variant)}`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function ExpenseActionButtons({
  leftButton,
  rightButton,
  size = 'default',
  className = '',
}: ExpenseActionButtonsProps) {
  return (
    <div className={`flex gap-2 ${className}`}>
      {leftButton && (
        <ActionButton
          {...leftButton}
          size={size}
        />
      )}
      <ActionButton
        {...rightButton}
        size={size}
      />
    </div>
  );
}

