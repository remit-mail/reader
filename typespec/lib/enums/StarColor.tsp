namespace RemitImap;

@doc("Gmail-style star colors for message/thread marking")
enum StarColor {
  @doc("No star")
  None: "none",

  @doc("Yellow star (default)")
  Yellow: "yellow",

  @doc("Orange star")
  Orange: "orange",

  @doc("Red star")
  Red: "red",

  @doc("Purple star")
  Purple: "purple",

  @doc("Blue star")
  Blue: "blue",

  @doc("Teal star")
  Teal: "teal",

  @doc("Green star")
  Green: "green",

  @doc("Yellow bang (exclamation)")
  YellowBang: "yellow_bang",

  @doc("Red bang")
  RedBang: "red_bang",

  @doc("Purple question")
  PurpleQuestion: "purple_question",

  @doc("Blue info")
  BlueInfo: "blue_info",

  @doc("Orange guillemet")
  OrangeGuillemet: "orange_guillemet",

  @doc("Green check")
  GreenCheck: "green_check",

  @doc("Yellow check")
  YellowCheck: "yellow_check",

  @doc("Blue star")
  BlueStar: "blue_star",
}
