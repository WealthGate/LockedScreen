namespace Lockedscreen.Core.Models;

public enum QuestionType
{
    MultipleChoice = 0,
    ShortAnswer = 1,
    Essay = 2
}

public enum ExamSourceType
{
    Typed = 0,
    ImportedDocx = 1,
    ImportedHtml = 2,
    Url = 3
}

public enum ThemePreference
{
    System = 0,
    Light = 1,
    Dark = 2
}

public enum LayoutDensity
{
    Comfortable = 0,
    Compact = 1
}
