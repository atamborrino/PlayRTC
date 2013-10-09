name := "playrtc-example"

version := "1.0-SNAPSHOT"

libraryDependencies ++= Seq(
  "org.mandubian" %% "play-actor-room" % "0.1",
  "com.github.atamborrino" %% "playrtc" % "0.1-SNAPSHOT"
)     

resolvers ++= Seq(
  "Mandubian repository releases" at "https://github.com/mandubian/mandubian-mvn/raw/master/releases/",
  Resolver.file("Local repo", file("/Users/atamborrino/.ivy2/local"))(Resolver.ivyStylePatterns)
)

play.Project.playScalaSettings
