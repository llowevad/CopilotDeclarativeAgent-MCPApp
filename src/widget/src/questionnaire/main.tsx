import React from "react";
import { createRoot } from "react-dom/client";
import { Body1, Card, FluentProvider, Subtitle1, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { McpAppProvider, useMcpTheme } from "../hooks/useMcpApp";
import { QuestionnaireApp } from "./QuestionnaireApp";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn("Questionnaire widget render failed.", error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell">
          <Card className="questionCard">
            <Subtitle1 as="h1">QUESTIONNAIRE_ERROR</Subtitle1>
            <Body1>The questionnaire could not be rendered. Ask the agent to reopen it.</Body1>
          </Card>
        </main>
      );
    }
    return this.props.children;
  }
}

function ThemedApp() {
  const theme = useMcpTheme();
  return (
    <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme}>
      <ErrorBoundary>
        <QuestionnaireApp />
      </ErrorBoundary>
    </FluentProvider>
  );
}

function App() {
  return (
    <McpAppProvider name="Grant Eligibility Questionnaire">
      <ThemedApp />
    </McpAppProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
