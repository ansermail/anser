cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.43"
  sha256 arm:   "047062245fe3b0b408cf05c5e4acbd91c47a1a8f3e0c122eae7a05979435e962",
         intel: "abb3def400cca242cbedef46f4f1319570c897c3253fbcc25847a4befb7f0e54"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
