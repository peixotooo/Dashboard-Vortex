"use client";

// DispatchWizardShell — chrome for the multi-step "Disparar" flow shared
// by the suggestion dispatch and the editor draft dispatch. Renders a
// horizontal step indicator at the top, the active step's content in
// the middle, and Voltar/Próximo navigation at the bottom. The actual
// step content + state is the parent dialog's responsibility — the
// shell just navigates and prevents proceeding when `canProceed` is
// false on the current step.

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Check, Loader2, Send } from "lucide-react";

export interface WizardExtraAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  /** Variant visual do botão. "outline" por default. */
  variant?: "default" | "outline" | "ghost" | "secondary";
  disabled?: boolean;
  /** Se true, mostra spinner no lugar do ícone. */
  loading?: boolean;
}

export interface WizardStep {
  /** Stable id (e.g. "review", "test", "audience"). */
  id: string;
  /** Short label rendered inside the step pill. */
  label: string;
  /** Step body. The parent provides JSX for each step. */
  content: React.ReactNode;
  /** Block "Próximo" until the user satisfies whatever this step needs. */
  canProceed?: boolean;
  /** Optional override for the Próximo button label on this step. */
  nextLabel?: string;
  /** Optional helper text shown next to the next button. */
  nextHint?: string;
  /** Botão extra no footer (e.g. "Salvar como rascunho" no step Conteúdo). */
  extraAction?: WizardExtraAction;
}

interface Props {
  steps: WizardStep[];
  currentIndex: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Triggered on the LAST step's primary action ("Disparar"). */
  onFinish: () => void;
  /** Disables all navigation while the parent is submitting. */
  isSubmitting?: boolean;
  /** Custom label for the final-step primary action. */
  finishLabel?: string;
  /** Icon for the final-step primary action. */
  finishIcon?: React.ReactNode;
}

export function DispatchWizardShell({
  steps,
  currentIndex,
  onBack,
  onNext,
  onClose,
  onFinish,
  isSubmitting,
  finishLabel = "Disparar",
  finishIcon = <Send className="w-3.5 h-3.5" />,
}: Props) {
  const step = steps[currentIndex];
  if (!step) return null;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === steps.length - 1;
  const canProceed = step.canProceed !== false;

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => {
          const status =
            i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
          return (
            <div key={s.id} className="flex items-center gap-1 flex-1">
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium uppercase tracking-widest flex-1 min-w-0 ${
                  status === "active"
                    ? "bg-foreground text-background"
                    : status === "done"
                      ? "bg-foreground/10 text-foreground/80"
                      : "bg-muted/40 text-muted-foreground"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                    status === "done"
                      ? "bg-foreground/20"
                      : status === "active"
                        ? "bg-background/20"
                        : "bg-muted"
                  }`}
                >
                  {status === "done" ? (
                    <Check className="w-2.5 h-2.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="truncate">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="space-y-3">{step.content}</div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t">
        <div className="flex gap-2">
          {!isFirst && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Voltar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {step.extraAction && (
            <Button
              variant={step.extraAction.variant ?? "outline"}
              size="sm"
              onClick={step.extraAction.onClick}
              disabled={step.extraAction.disabled || step.extraAction.loading}
              className="gap-1.5"
            >
              {step.extraAction.loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                step.extraAction.icon
              )}
              {step.extraAction.label}
            </Button>
          )}
          {step.nextHint && !isLast && (
            <span className="text-[10px] text-muted-foreground">
              {step.nextHint}
            </span>
          )}
          {isLast ? (
            <Button
              size="sm"
              onClick={onFinish}
              disabled={isSubmitting || !canProceed}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                finishIcon
              )}
              {isSubmitting ? "Enviando..." : finishLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onNext}
              disabled={!canProceed || isSubmitting}
              className="gap-1.5"
            >
              {step.nextLabel ?? "Próximo"}
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
